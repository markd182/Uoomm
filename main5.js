const blessed = require('blessed');
const contrib = require('blessed-contrib');
const chalk = require('chalk');
const gradient = require('gradient-string');
const path = require('path');
const fs = require('fs');

// ---- MENU OPTIONS (No Emojis, Bold Labels) ----
const menuOptions = [
  { label: 'Rubic Swap', value: 'rubic' },
  { label: 'Magma Staking', value: 'magma' },
  { label: 'Izumi Swap', value: 'izumi' },
  { label: 'aPriori Staking', value: 'apriori' },
  { label: 'Kintsu Staking', value: 'kintsu' },
  { label: 'Bean Swap', value: 'bean' },
  { label: 'Monorail Swap', value: 'mono' },
  { label: 'Bebop Swap', value: 'bebop' },
  { label: 'Ambient Swap', value: 'ambient' },
  { label: 'Uniswap Swap', value: 'uniswap' },
  { label: 'Deploy Contract', value: 'deploy' },
  { label: 'Send TX', value: 'sendtx' },
  { label: 'Bima Deposit', value: 'bima' },
  { label: 'Mint Lil Chogstars', value: 'lilchogstars' },
  { label: 'Nad Domains', value: 'naddomains' },
  { label: 'Shmonad', value: 'shmonad' },
  { label: 'Clober Testnet', value: 'clober' },
  { label: 'MonadBox', value: 'monadbox' }, // New MonadBox task
  { label: 'Exit', value: 'exit' },
];

// ---- BANNER ----
const asciiBannerLines = [
  ' ███╗   ███╗ ██████╗ ███╗   ██╗ █████╗ ██████╗ ',
  ' ████╗ ████║██╔═══██╗████╗  ██║██╔══██╗██╔══██╗',
  ' ██╔████╔██║██║   ██║██╔██╗ ██║███████║██║  ██║',
  ' ██║╚██╔╝██║██║   ██║██║╚██╗██║██╔══██║██║  ██║',
  ' ██║ ╚═╝ ██║╚██████╔╝██║ ╚████║██║  ██║██████╔╝',
  ' ╚═╝     ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝╚═════╝',
  '      MONAD TESTNET PRO - FULL COMPLETE      ',
];

function animateBanner(bannerBox, screen, callback) {
  let idx = 0;
  const total = asciiBannerLines.length;
  const lines = [];
  const colors = ['atlas', 'cristal', 'teen', 'mind'];

  function showNextLine() {
    try {
      if (idx < total) {
        lines.push(asciiBannerLines[idx]);
        const color = colors[idx % colors.length];
        if (gradient[color] && typeof gradient[color].multiline === 'function') {
          bannerBox.setContent(gradient[color].multiline(lines.join('\n')));
        } else {
          bannerBox.setContent(chalk.white(lines.join('\n')));
          console.error(`Gradient theme '${color}' not supported. Using plain text.`);
        }
        screen.render();
        idx++;
        setTimeout(showNextLine, 100);
      } else if (callback) {
        setTimeout(callback, 300);
      }
    } catch (error) {
      console.error(`Error in animateBanner: ${error.message}`);
      bannerBox.setContent(chalk.red('Error rendering banner'));
      screen.render();
      if (callback) callback();
    }
  }
  showNextLine();
}

function pulseBanner(bannerBox, screen) {
  let bright = true;
  setInterval(() => {
    try {
      const colors = bright ? ['atlas', 'teen'] : ['cristal', 'mind'];
      const selectedColor = colors[Math.floor(Math.random() * colors.length)];
      if (gradient[selectedColor] && typeof gradient[selectedColor].multiline === 'function') {
        bannerBox.setContent(gradient[selectedColor].multiline(asciiBannerLines.join('\n')));
      } else {
        bannerBox.setContent(chalk.white(asciiBannerLines.join('\n')));
        console.error(`Gradient theme '${selectedColor}' not supported. Using plain text.`);
      }
      screen.render();
      bright = !bright;
    } catch (error) {
      console.error(`Error in pulseBanner: ${error.message}`);
      bannerBox.setContent(chalk.red('Error rendering banner'));
      screen.render();
    }
  }, 1500);
}

// ---- INPUT MODAL ----
function requestInput(screen, promptText, type = 'text', defaultValue = '') {
  return new Promise((resolve) => {
    const promptBox = blessed.prompt({
      parent: screen,
      top: 'center',
      left: 'center',
      width: '60%',
      height: 9,
      border: { type: 'line', fg: '#00ff00' },
      label: ' Input ',
      tags: true,
      keys: true,
      vi: true,
      mouse: true,
      style: {
        fg: 'white',
        bg: '#1a1a1a',
        border: { fg: '#00ff00' },
        label: { fg: '#00ff00', bold: true },
      },
    });

    promptBox.input(
      chalk.cyan.bold(promptText) + (defaultValue ? ` [${defaultValue}]` : ''),
      '',
      (err, value) => {
        if (type === 'number') value = Number(value);
        if (isNaN(value) || value === '' || value === undefined) value = defaultValue;
        promptBox.destroy();
        screen.render();
        resolve(value);
      }
    );
    screen.render();
  });
}

// ---- MAIN ----
async function main() {
  const screen = blessed.screen({
    smartCSR: true,
    title: 'Monad Testnet Pro - Full HD UI v2',
    autoPadding: true,
    fullUnicode: true,
  });

  // Banner box
  const bannerBox = blessed.box({
    top: 0,
    left: 'center',
    width: '100%',
    height: asciiBannerLines.length + 1,
    align: 'center',
    tags: true,
    content: '',
    style: { fg: 'white', bg: '#0a0a0a' },
  });

  // Menu
  const menuBox = blessed.list({
    top: asciiBannerLines.length + 1,
    left: 0,
    width: 40,
    height: '68%',
    label: chalk.bold.hex('#ff00ff')(' MENU '),
    tags: true,
    keys: true,
    mouse: true,
    vi: true,
    padding: { left: 1, right: 1 },
    border: { type: 'line', fg: '#ff00ff' },
    style: {
      fg: 'white',
      bg: '#1a1a1a',
      border: { fg: '#ff00ff' },
      selected: { bg: '#ff00ff', fg: 'white', bold: true },
      item: { hover: { bg: '#00ff00', fg: 'white', bold: true } },
      label: { fg: '#ff00ff', bold: true },
    },
    items: menuOptions.map((opt) => chalk.bold(opt.label)),
    scrollbar: {
      ch: '█',
      track: { bg: '#333333' },
      style: { bg: '#00ff00' },
    },
  });

  // Main panel (logs)
  const panelBox = blessed.log({
    top: asciiBannerLines.length + 1,
    left: 41,
    width: '60%',
    height: '68%',
    label: chalk.bold.hex('#00ff00')(' SCRIPT LOGS '),
    tags: true,
    border: { type: 'line', fg: '#00ff00' },
    style: {
      fg: 'white',
      bg: '#1a1a1a',
      border: { fg: '#00ff00' },
      label: { fg: '#00ff00', bold: true },
    },
    scrollable: true,
    alwaysScroll: true,
    scrollbar: {
      ch: '█',
      track: { bg: '#333333' },
      style: { bg: '#00ff00' },
    },
    content: chalk.cyanBright('\nSelect a script to view logs...'),
  });

  // Info panel (script info)
  const infoBox = blessed.box({
    top: '68%',
    left: 0,
    width: '100%',
    height: '27%',
    label: chalk.bold.hex('#ffaa00')(' INFO PANEL '),
    border: { type: 'line', fg: '#ffaa00' },
    tags: true,
    scrollable: true,
    alwaysScroll: true,
    padding: { left: 1, right: 1 },
    style: {
      fg: 'white',
      bg: '#1a1a1a',
      border: { fg: '#ffaa00' },
      label: { fg: '#ffaa00', bold: true },
    },
    content: chalk.cyanBright('\nSelect a script from the menu...'),
  });

  // Status bar
  const statusBar = blessed.box({
    bottom: 0,
    left: 0,
    width: '100%',
    height: 3,
    align: 'center',
    tags: true,
    style: { fg: 'white', bg: '#ff00ff' },
    content: chalk.white.bold(
      ' Contact: https://t.me/thog099 | Channel: https://t.me/thogairdrops | Replit: Thog | Press [q] to quit '
    ),
  });

  // Add elements to screen
  screen.append(bannerBox);
  screen.append(menuBox);
  screen.append(panelBox);
  screen.append(infoBox);
  screen.append(statusBar);

  menuBox.focus();

  // Animate banner and pulse
  try {
    animateBanner(bannerBox, screen, () => {
      pulseBanner(bannerBox, screen);
      screen.render();
    });
  } catch (error) {
    console.error(`Error initializing banner animation: ${error.message}`);
    bannerBox.setContent(chalk.red('Error rendering banner'));
    screen.render();
  }

  // Exit keys
  function closeUI() {
    try {
      infoBox.setContent(chalk.redBright('\nExiting Monad Testnet Pro...'));
      panelBox.setContent(chalk.redBright('\nExiting application...'));
      screen.render();
      setTimeout(() => {
        screen.destroy();
        process.exit(0);
      }, 500);
    } catch (error) {
      console.error(`Error during exit: ${error.message}`);
      process.exit(1);
    }
  }
  screen.key(['q', 'C-c', 'escape'], closeUI);

  // Menu navigation
  menuBox.on('select', async (item, idx) => {
    const selected = menuOptions[idx];
    if (!selected) return;

    if (selected.value === 'exit') {
      closeUI();
      return;
    }

    // Map menu value to script file
    const scriptMap = {
      rubic: 'TheRubic',
      magma: 'Magma',
      izumi: 'The-izumi',
      apriori: 'Priori',
      kintsu: 'KintuSwap',
      bean: 'BeanSwap',
      mono: 'MonoRail',
      bebop: 'Bebop-Swap',
      ambient: 'Ambiention',
      uniswap: 'Uni-swap',
      deploy: 'Deployment',
      sendtx: 'sendtx',
      bima: 'Bima-Deposit',
      lilchogstars: 'ChogStars',
      naddomains: 'NadDomain',
      shmonad: 'MonadSh',
      clober: 'CloberTestnet',
      monadbox: 'MonadBox', // Map monadbox to MonadBox.js
    };

    if (scriptMap[selected.value]) {
      try {
        const scriptPath = path.join(__dirname, 'src', scriptMap[selected.value] + '.js');
        if (!fs.existsSync(scriptPath)) {
          infoBox.setContent(chalk.redBright(`\nError: Script file not found at ${scriptPath}`));
          panelBox.setContent(chalk.redBright(`\nError: Script file not found: ${scriptPath}`));
          screen.render();
          menuBox.focus();
          return;
        }
        panelBox.setContent(''); // Clear logs
        infoBox.setContent(chalk.cyanBright(`\nRunning ${selected.label}...`));
        screen.render();

        const scriptFunc = require(scriptPath);
        await scriptFunc(
          (log) => {
            panelBox.log(chalk.hex('#ffffff')(log));
            screen.render();
          }, // addLog
          (content) => {
            infoBox.setContent(chalk.hex('#ffffff')(content));
            screen.render();
          }, // updatePanel
          closeUI,
          async (promptText, type, defaultValue) => {
            return await requestInput(screen, promptText, type, defaultValue);
          },
          'en' // Language: English
        );
        infoBox.setContent(chalk.cyanBright(`\n${selected.label} completed. Select another script...`));
        screen.render();
        menuBox.focus();
      } catch (e) {
        infoBox.setContent(chalk.redBright(`\nError running ${selected.label}: ${e.message}`));
        panelBox.log(chalk.redBright(`Error: ${e.message}`));
        screen.render();
        menuBox.focus();
      }
      return;
    }

    // Not implemented
    infoBox.setContent(
      chalk.yellowBright(`\n${selected.label}\n\n`) + chalk.gray('Script not implemented yet.')
    );
    screen.render();
    menuBox.focus();
  });

  // On highlight, show info in panel
  menuBox.on('highlight item', (item, idx) => {
    if (!item) return;
    const selected = menuOptions[idx];
    if (!selected) return;
    infoBox.setContent(
      chalk.yellowBright.bold(`\n${selected.label}\n\n`) +
      chalk.gray('Press Enter to run this script.')
    );
    screen.render();
  });

  // Initial highlight
  menuBox.select(0);
  menuBox.emit('highlight item', menuBox.items[0], 0);

  // Menu animation
  let menuPulse = true;
  setInterval(() => {
    try {
      menuBox.style.border.fg = menuPulse ? '#ff00ff' : '#00ff00';
      menuBox.style.label.fg = menuPulse ? '#ff00ff' : '#00ff00';
      screen.render();
      menuPulse = !menuPulse;
    } catch (error) {
      console.error(`Error in menu pulse animation: ${error.message}`);
    }
  }, 800);

  screen.render();
}

// ---- Run Main with Error Handling ----
(async () => {
  try {
    await main();
  } catch (error) {
    console.error(`Fatal error in main: ${error.message}`);
    process.exit(1);
  }
})();
