const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URLS = [
  'https://testnet-rpc.monorail.xyz',
  'https://testnet-rpc.monad.xyz',
  'https://monad-testnet.drpc.org',
];
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const ROUTER_ADDRESS = '0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89';
const WMON_ADDRESS = '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701';

// Supported tokens
const TOKENS = {
  USDC: {
    address: '0x62534E4bBD6D9ebAC0ac99aeaa0aa48E56372df0',
    symbol: 'USDC',
    name: 'USD Coin',
    minAmount: 0.01,
    maxAmount: 1,
    decimals: 6,
  },
  USDT: {
    address: '0x88b8e2161dedc77ef4ab7585569d2415a1c1055d',
    symbol: 'USDT',
    name: 'Tether USD',
    minAmount: 0.01,
    maxAmount: 1,
    decimals: 6,
  },
  BEAN: {
    address: '0x268E4E24E0051EC27b3D27A95977E71cE6875a05',
    symbol: 'BEAN',
    name: 'Bean Token',
    minAmount: 0.01,
    maxAmount: 1,
    decimals: 6,
  },
  JAI: {
    address: '0x70F893f65E3C1d7f82aad72f71615eb220b74D10',
    symbol: 'JAI',
    name: 'Jai Token',
    minAmount: 0.01,
    maxAmount: 1,
    decimals: 6,
  },
};

// ERC20 ABI
const ERC20_ABI = [
  { constant: false, inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], type: 'function' },
  { constant: true, inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], type: 'function' },
  { constant: true, inputs: [], name: 'symbol', outputs: [{ name: '', type: 'string' }], type: 'function' },
];

// Router ABI
const ROUTER_ABI = [
  { inputs: [{ internalType: 'uint256', name: 'amountOutMin', type: 'uint256' }, { internalType: 'address[]', name: 'path', type: 'address[]' }, { internalType: 'address', name: 'to', type: 'address' }, { internalType: 'uint256', name: 'deadline', type: 'uint256' }], name: 'swapExactETHForTokens', outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }], stateMutability: 'payable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'amountIn', type: 'uint256' }, { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' }, { internalType: 'address[]', name: 'path', type: 'address[]' }, { internalType: 'address', name: 'to', type: 'address' }, { internalType: 'uint256', name: 'deadline', type: 'uint256' }], name: 'swapExactTokensForETH', outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }], stateMutability: 'nonpayable', type: 'function' },
];

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

function printStep(step, message, lang) {
  const steps = {
    en: {
      approve: 'Approve Token',
      swap: 'Swap',
    },
  };
  const stepText = steps[lang][step] || 'UNKNOWN';
  const formattedStep = `${chalk.yellow('🔸')} ${chalk.cyan(stepText.padEnd(15))}`;
  return `${formattedStep} | ${message}`;
}

function printHeader(text, color = chalk.cyan) {
  return `${color(`--- ${text} ---`)}`;
}

// Fallback logging function
const safeLog = (message, addLog) => {
  if (typeof addLog === 'function') {
    addLog(message);
  } else {
    console.log(message);
  }
};

const safeUpdatePanel = (message, updatePanel) => {
  if (typeof updatePanel === 'function') {
    updatePanel(message);
  }
};

// Connect to RPC with failover
async function connectToRpc(addLog, updatePanel) {
  for (const url of RPC_URLS) {
    const w3 = new Web3(new Web3.providers.HttpProvider(url));
    try {
      await w3.eth.getBlockNumber();
      safeLog(chalk.blue(`🪫 Connected to RPC: ${url}`), addLog);
      return w3;
    } catch (e) {
      safeLog(chalk.yellow(`Failed to connect to ${url}, trying next RPC...`), addLog);
    }
  }
  const errorMsg = chalk.red('❌ Unable to connect to any RPC');
  safeLog(errorMsg, addLog);
  safeUpdatePanel(errorMsg, updatePanel);
  throw new Error('Unable to connect to any RPC');
}

// Load private keys from pvkey.txt
async function loadPrivateKeys(addLog, updatePanel) {
  try {
    const data = await fs.readFile('pvkey.txt', 'utf8');
    const keys = data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
    if (!keys.length) {
      throw new Error('pvkey.txt is empty');
    }
    return keys;
  } catch (e) {
    const errorMsg = chalk.red(`❌ Error reading pvkey.txt: ${e.message}`);
    safeLog(errorMsg, addLog);
    safeUpdatePanel(errorMsg, updatePanel);
    return [];
  }
}

// Generate random amount (0.001–0.01 MON)
function getRandomAmount() {
  return Number(randomInRange(0.001, 0.01).toFixed(6));
}

// Generate random delay (1–3 minutes)
function getRandomDelay() {
  return randomInRange(60, 180) * 1000; // Return milliseconds
}

// BeanSwap class
class BeanSwap {
  constructor(w3, accountIndex, privateKey, language) {
    this.w3 = w3;
    this.accountIndex = accountIndex;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.language = language;
    this.router = new w3.eth.Contract(ROUTER_ABI, ROUTER_ADDRESS);
  }

  async approveToken(tokenAddress, amount, decimals, addLog, maxRetries = 3) {
    const tokenContract = new this.w3.eth.Contract(ERC20_ABI, tokenAddress);
    let symbol;
    try {
      symbol = await tokenContract.methods.symbol().call();
    } catch (e) {
      symbol = 'Unknown';
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const walletShort = this.account.address.slice(0, 8) + '...';
        safeLog(printStep('approve', `Approving ${symbol}`, this.language), addLog);

        const amountInDecimals = decimals === 18 ? this.w3.utils.toWei(amount.toString(), 'ether') : Math.floor(amount * 10 ** decimals);
        const tx = {
          to: tokenAddress,
          data: tokenContract.methods.approve(ROUTER_ADDRESS, amountInDecimals).encodeABI(),
          from: this.account.address,
          gas: 150000, // Increased from 100000
          gasPrice: await this.w3.eth.getGasPrice() * 1.5, // Increased gas price
          nonce: await this.w3.eth.getTransactionCount(this.account.address),
          chainId: 10143,
        };

        const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.account.privateKey);
        const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        await sleep(2000);
        if (txHash.status) {
          safeLog(printStep('approve', chalk.green(`✔ ${symbol} approved`), this.language), addLog);
          return amountInDecimals;
        } else {
          throw new Error(`Approve failed: Status ${txHash.status}`);
        }
      } catch (e) {
        if (e.message.includes('429') && attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(printStep('approve', chalk.yellow(`Rate limit hit, retrying in ${delay / 1000}s...`), this.language), addLog);
          await sleep(delay);
        } else {
          safeLog(printStep('approve', chalk.red(`✘ Failed: ${e.message}`), this.language), addLog);
          throw e;
        }
      }
    }
  }

  async swapTokenToMon(tokenSymbol, amount, addLog, maxRetries = 3) {
    const token = TOKENS[tokenSymbol];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const walletShort = this.account.address.slice(0, 8) + '...';
        const headerMsg = `Swapping ${amount} ${tokenSymbol} to MON | ${walletShort}`;
        safeLog(printHeader(headerMsg, chalk.blue), addLog);

        const amountInDecimals = await this.approveToken(token.address, amount, token.decimals, addLog);
        const tx = {
          to: ROUTER_ADDRESS,
          data: this.router.methods.swapExactTokensForETH(
            amountInDecimals,
            0,
            [token.address, WMON_ADDRESS],
            this.account.address,
            Math.floor(Date.now() / 1000) + 600
          ).encodeABI(),
          from: this.account.address,
          gas: 400000, // Increased from 300000
          gasPrice: await this.w3.eth.getGasPrice() * 1.5, // Increased gas price
          nonce: await this.w3.eth.getTransactionCount(this.account.address),
          chainId: 10143,
        };

        safeLog(printStep('swap', 'Sending swap transaction...', this.language), addLog);
        const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.account.privateKey);
        const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        safeLog(printStep('swap', `Tx Hash: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language), addLog);
        await sleep(2000);
        if (txHash.status) {
          safeLog(printStep('swap', chalk.green('✔ Swap successful!'), this.language), addLog);
          return true;
        } else {
          throw new Error(`Transaction failed: Status ${txHash.status}`);
        }
      } catch (e) {
        if ((e.message.includes('429') || e.message.includes('revert')) && attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(printStep('swap', chalk.yellow(`Swap failed, retrying in ${delay / 1000}s: ${e.message}`), this.language), addLog);
          await sleep(delay);
        } else {
          safeLog(printStep('swap', chalk.red(`✘ Failed: ${e.message}`), this.language), addLog);
          return false;
        }
      }
    }
    return false;
  }

  async swapMonToToken(tokenSymbol, amount, addLog, maxRetries = 3) {
    const token = TOKENS[tokenSymbol];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const walletShort = this.account.address.slice(0, 8) + '...';
        const headerMsg = `Swapping ${amount} MON to ${tokenSymbol} | ${walletShort}`;
        safeLog(printHeader(headerMsg, chalk.blue), addLog);

        const tx = {
          to: ROUTER_ADDRESS,
          data: this.router.methods.swapExactETHForTokens(
            0,
            [WMON_ADDRESS, token.address],
            this.account.address,
            Math.floor(Date.now() / 1000) + 600
          ).encodeABI(),
          from: this.account.address,
          value: this.w3.utils.toWei(amount.toString(), 'ether'),
          gas: 400000, // Increased from 300000
          gasPrice: await this.w3.eth.getGasPrice() * 1.5, // Increased gas price
          nonce: await this.w3.eth.getTransactionCount(this.account.address),
          chainId: 10143,
        };

        safeLog(printStep('swap', 'Sending swap transaction...', this.language), addLog);
        const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.account.privateKey);
        const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        safeLog(printStep('swap', `Tx Hash: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language), addLog);
        await sleep(2000);
        if (txHash.status) {
          safeLog(printStep('swap', chalk.green('✔ Swap successful!'), this.language), addLog);
          return true;
        } else {
          throw new Error(`Transaction failed: Status ${txHash.status}`);
        }
      } catch (e) {
        if ((e.message.includes('429') || e.message.includes('revert')) && attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(printStep('swap', chalk.yellow(`Swap failed, retrying in ${delay / 1000}s: ${e.message}`), this.language), addLog);
          await sleep(delay);
        } else {
          safeLog(printStep('swap', chalk.red(`✘ Failed: ${e.message}`), this.language), addLog);
          return false;
        }
      }
    }
    return false;
  }

  async checkBalance(addLog, maxRetries = 3) {
    const walletShort = this.account.address.slice(0, 8) + '...';
    safeLog(printHeader(`Balance | ${walletShort}`, chalk.cyan), addLog);

    try {
      const monBalance = await this.w3.eth.getBalance(this.account.address);
      safeLog(printStep('swap', `MON: ${chalk.cyan(this.w3.utils.fromWei(monBalance, 'ether'))}`, this.language), addLog);
    } catch (e) {
      safeLog(printStep('swap', `MON: ${chalk.red(`Error reading balance - ${e.message}`)}`, this.language), addLog);
    }

    for (const [symbol, token] of Object.entries(TOKENS)) {
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          const tokenContract = new this.w3.eth.Contract(ERC20_ABI, token.address);
          const balance = await tokenContract.methods.balanceOf(this.account.address).call();
          safeLog(printStep('swap', `${symbol}: ${chalk.cyan((balance / 10 ** token.decimals).toFixed(6))}`, this.language), addLog);
          break;
        } catch (e) {
          if (e.message.includes('429') && attempt < maxRetries - 1) {
            const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
            safeLog(printStep('swap', chalk.yellow(`${symbol}: Too many requests, retrying in ${delay / 1000}s...`), this.language), addLog);
            await sleep(delay);
          } else {
            safeLog(printStep('swap', `${symbol}: ${chalk.red(`Error reading balance - ${e.message}`)}`, this.language), addLog);
            break;
          }
        }
        await sleep(1000); // Delay between tokens
      }
    }
  }

  async performRandomSwap(addLog) {
    const walletShort = this.account.address.slice(0, 8) + '...';
    let isMonToToken = Math.random() < 0.5;
    const tokenSymbols = Object.keys(TOKENS);
    const tokenSymbol = tokenSymbols[Math.floor(Math.random() * tokenSymbols.length)];
    const token = TOKENS[tokenSymbol];
    const amount = getRandomAmount();

    // Check if any token has a non-zero balance
    let hasTokenBalance = false;
    for (const [symbol, token] of Object.entries(TOKENS)) {
      try {
        const tokenContract = new this.w3.eth.Contract(ERC20_ABI, token.address);
        const balance = await tokenContract.methods.balanceOf(this.account.address).call();
        if (balance > 0) {
          hasTokenBalance = true;
          break;
        }
      } catch (e) {
        safeLog(chalk.red(`Error checking ${symbol} balance: ${e.message}`), addLog);
      }
    }

    if (!isMonToToken && !hasTokenBalance) {
      safeLog(chalk.yellow(`⚠ No token balances available, forcing MON → ${tokenSymbol} swap`), addLog);
      isMonToToken = true;
    }

    if (!isMonToToken) {
      // Check token balance for token → MON swap
      const tokenContract = new this.w3.eth.Contract(ERC20_ABI, token.address);
      try {
        const balance = await tokenContract.methods.balanceOf(this.account.address).call();
        const balanceInUnits = balance / 10 ** token.decimals;
        if (balanceInUnits < amount) {
          safeLog(chalk.yellow(`⚠ Insufficient ${tokenSymbol} balance: ${balanceInUnits.toFixed(6)} < ${amount}`), addLog);
          return false;
        }
      } catch (e) {
        safeLog(chalk.red(`Error checking ${tokenSymbol} balance: ${e.message}`), addLog);
        return false;
      }
    }

    if (isMonToToken) {
      // Check MON balance for MON → token swap
      try {
        const monBalance = await this.w3.eth.getBalance(this.account.address);
        const monBalanceInUnits = Number(this.w3.utils.fromWei(monBalance, 'ether'));
        if (monBalanceInUnits < amount) {
          safeLog(chalk.yellow(`⚠ Insufficient MON balance: ${monBalanceInUnits.toFixed(6)} < ${amount}`), addLog);
          return false;
        }
      } catch (e) {
        safeLog(chalk.red(`Error checking MON balance: ${e.message}`), addLog);
        return false;
      }
    }

    if (isMonToToken) {
      safeLog(printHeader(`Random Swap: ${amount} MON → ${tokenSymbol} | ${walletShort}`, chalk.yellow), addLog);
      return await this.swapMonToToken(tokenSymbol, amount, addLog);
    } else {
      safeLog(printHeader(`Random Swap: ${amount} ${tokenSymbol} → MON | ${walletShort}`, chalk.yellow), addLog);
      return await this.swapTokenToMon(tokenSymbol, amount, addLog);
    }
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput, language) => {
  const w3 = await connectToRpc(addLog, updatePanel);

  // Update addresses with checksum
  const routerAddress = w3.utils.toChecksumAddress(ROUTER_ADDRESS);
  const wmonAddress = w3.utils.toChecksumAddress(WMON_ADDRESS);
  const tokens = Object.fromEntries(
    Object.entries(TOKENS).map(([key, value]) => [key, { ...value, address: w3.utils.toChecksumAddress(value.address) }])
  );

  safeLog(chalk.green('--- BEAN SWAP - MONAD TESTNET ---'), addLog);
  safeLog(chalk.cyan(`👥 Accounts: Loading...`), addLog);
  safeUpdatePanel(chalk.green('--- BEAN SWAP - MONAD TESTNET ---'), updatePanel);

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys.length) {
    safeLog(chalk.red('No private keys loaded, exiting'), addLog);
    return;
  }

  safeLog(chalk.cyan(`👥 Accounts: ${privateKeys.length}`), addLog);
  safeUpdatePanel(chalk.cyan(`👥 Accounts: ${privateKeys.length}`), updatePanel);

  let cycles;
  while (true) {
    safeLog(printHeader('NUMBER OF CYCLES', chalk.yellow), addLog);
    const cyclesInput = await requestInput(chalk.green('➤ Enter number (default 5): '));
    try {
      cycles = cyclesInput.trim() ? parseInt(cyclesInput) : 5;
      if (cycles <= 0) throw new Error('Invalid number');
      break;
    } catch (e) {
      safeLog(chalk.red('❌ Please enter a valid number!'), addLog);
    }
  }

  const startMsg = `Running ${cycles} Bean swaps with random 1-3 minute delay for ${privateKeys.length} accounts...`;
  safeLog(chalk.yellow(`🚀 ${startMsg}`), addLog);
  safeUpdatePanel(chalk.yellow(`🚀 ${startMsg}`), updatePanel);

  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const walletShort = w3.eth.accounts.privateKeyToAccount(privateKey).address.slice(0, 8) + '...';
    const accountMsg = `ACCOUNT ${idx + 1}/${privateKeys.length} | ${walletShort}`;
    safeLog(printHeader(accountMsg, chalk.blue), addLog);
    safeUpdatePanel(chalk.blue(accountMsg), updatePanel);

    const beanSwap = new BeanSwap(w3, idx + 1, privateKey, language);
    await beanSwap.checkBalance(addLog);

    for (let i = 0; i < cycles; i++) {
      try {
        safeLog(printHeader(`BEAN SWAP CYCLE ${i + 1}/${cycles}`, chalk.cyan), addLog);
        const success = await beanSwap.performRandomSwap(addLog);
        if (success) {
          await beanSwap.checkBalance(addLog);
        } else {
          safeLog(chalk.yellow(`Cycle ${i + 1} skipped due to insufficient balance or error`), addLog);
        }

        if (i < cycles - 1) {
          const delay = getRandomDelay();
          safeLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next cycle...`), addLog);
          await sleep(delay);
        }
      } catch (e) {
        safeLog(chalk.red(`Error in cycle ${i + 1}: ${e.message}`), addLog);
      }
    }

    if (idx < privateKeys.length - 1) {
      const delay = getRandomDelay();
      safeLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next account...`), addLog);
      safeUpdatePanel(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next account...`), updatePanel);
      await sleep(delay);
    }
  }

  const completionMsg = `
${chalk.green('--- ALL DONE ---')}
${chalk.green(`Completed ${cycles} cycles for ${privateKeys.length} accounts`)}
${chalk.green('----------------')}
`;
  safeLog(completionMsg, addLog);
  safeUpdatePanel(completionMsg, updatePanel);
};
