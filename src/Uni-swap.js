const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URLS = [
  'https://testnet-rpc.monad.xyz',
  'https://testnet-rpc.monorail.xyz',
  'https://monad-testnet.drpc.org',
];
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const UNISWAP_V2_ROUTER_ADDRESS = '0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89';
const WETH_ADDRESS = '0x760AfE86e5de5fa0ee542fc7B7b713e1c5425701';
const TOKEN_ADDRESSES = {
  DAC: '0x0f0bdebf0f83cd1ee3974779bcb7315f9808c714',
  USDT: '0x88b8e2161dedc77ef4ab7585569d2415a1c1055d',
  WETH: '0x836047a99e11f376522b447bffb6e3495dd0637c',
  MUK: '0x989d38aeed8408452f0273c7d4a17fef20878e62',
  USDC: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea',
  CHOG: '0xE0590015A873bF326bd645c3E1266d4db41C4E6B',
};

// ERC20 ABI
const ERC20_ABI = [
  {
    constant: true,
    inputs: [{ name: '_owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: 'balance', type: 'uint256' }],
    type: 'function',
  },
  {
    constant: false,
    inputs: [
      { name: '_spender', type: 'address' },
      { name: '_value', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    type: 'function',
  },
];

// Uniswap V2 Router ABI
const ROUTER_ABI = [
  {
    name: 'swapExactETHForTokens',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETH',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { internalType: 'uint256', name: 'amountIn', type: 'uint256' },
      { internalType: 'uint256', name: 'amountOutMin', type: 'uint256' },
      { internalType: 'address[]', name: 'path', type: 'address[]' },
      { internalType: 'address', name: 'to', type: 'address' },
      { internalType: 'uint256', name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ internalType: 'uint256[]', name: 'amounts', type: 'uint256[]' }],
  },
];

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

// Generate random delay (60–180 seconds)
function getRandomDelay() {
  return randomInRange(60, 180) * 1000; // Return milliseconds
}

// Generate random ETH amount (0.0001–0.01)
function getRandomEthAmount(w3) {
  const amount = randomInRange(0.0001, 0.01).toFixed(6);
  return w3.utils.toWei(amount, 'ether');
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

// Language translations (English only)
const translations = {
  title: 'UNISWAP - MONAD TESTNET',
  accounts: 'Accounts',
  account: 'ACCOUNT',
  cyclesPrompt: 'Enter number of cycles (default 1): ',
  cyclesError: 'Number must be > 0 / Enter a valid number!',
  startCycle: (cycle, total, idx, totalAccounts, wallet) =>
    `CYCLE ${cycle}/${total} | Account ${idx}/${totalAccounts} | ${wallet}`,
  startSwapEth: (amount, token, wallet) => `Swapping ${amount} MON to ${token} | ${wallet}`,
  startSwapToken: (token, wallet) => `Swapping ${token} to MON | ${wallet}`,
  approving: (token) => `Approving ${token}`,
  approved: (token) => `${token} approved`,
  sending: 'Sending transaction...',
  success: 'Swap successful!',
  noBalance: (token) => `No ${token}, skipping`,
  tx: (txHash) => `🔗 Tx: ${EXPLORER_URL}${txHash}`,
  fail: (error) => `❌ Failed: ${error}`,
  waitCycle: (minutes) => `⏳ Waiting ${minutes} minutes before next cycle...`,
  waitAccount: (minutes) => `⏳ Waiting ${minutes} minutes before next account...`,
  done: (cycles, accounts) => `ALL DONE - ${cycles} CYCLES FOR ${accounts} ACCOUNTS`,
  pending: '⚠ Pending transaction detected, skipping this wallet...',
  insufficientMon: (balance, required) =>
    `❌ Insufficient MON balance: ${balance} < ${required}`,
  insufficientToken: (token, balance, required) =>
    `❌ Insufficient ${token} balance: ${balance} < ${required}`,
  balanceHeader: (idx, total, wallet) => `BALANCE | Account ${idx}/${total} | ${wallet}`,
  balance: (symbol, amount) => `${symbol}: ${amount}`,
  debug: (tx) =>
    `Transaction details: To=${tx.to}, Value=${tx.value || 0}, Data=${
      tx.data ? tx.data.slice(0, 50) + '...' : 'none'
    }`,
};

// Print header (no square borders)
function printHeader(text, color = chalk.cyan) {
  return `${color(`--- ${text} ---`)}`;
}

// Print step
function printStep(step, message, addLog) {
  const steps = { approve: 'Approve', swap: 'Swap', balance: 'Balance' };
  const stepText = steps[step];
  safeLog(`${chalk.yellow('➤')} ${chalk.cyan(stepText.padEnd(15))} | ${message}`, addLog);
}

// Get number of cycles
async function getCycles(requestInput, addLog) {
  const lang = translations;
  while (true) {
    safeLog(printHeader('NUMBER OF CYCLES', chalk.yellow), addLog);
    const input = await requestInput(chalk.green('➤ ') + lang.cyclesPrompt);
    const cycles = input.trim() ? parseInt(input, 10) : 1;
    if (isNaN(cycles) || cycles <= 0) {
      safeLog(chalk.red(`❌ ${lang.cyclesError}`), addLog);
      continue;
    }
    return cycles;
  }
}

// Retry on 429 errors
async function retryOn429(operation, addLog, maxRetries = 3, baseDelay = 2000) {
  const lang = translations;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await operation();
    } catch (e) {
      if (e.message.includes('429') && attempt < maxRetries - 1) {
        const delay = baseDelay * 2 ** attempt; // Exponential backoff: 2s, 4s, 8s
        safeLog(
          chalk.yellow(`⚠ Too many requests, retrying in ${delay / 1000}s...`),
          addLog
        );
        await sleep(delay);
      } else {
        throw e;
      }
    }
  }
}

// Approve token
async function approveToken(w3, privateKey, tokenAddress, amount, tokenSymbol, addLog) {
  const lang = translations;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const tokenContract = new w3.eth.Contract(ERC20_ABI, w3.utils.toChecksumAddress(tokenAddress));

    const balance = await tokenContract.methods.balanceOf(account.address).call();
    const balanceEth = w3.utils.fromWei(balance, 'ether');
    const amountEth = w3.utils.fromWei(amount, 'ether');
    if (balance < amount) {
      throw new Error(lang.insufficientToken(tokenSymbol, balanceEth, amountEth));
    }

    let nonce = await w3.eth.getTransactionCount(account.address, 'pending');
    const pendingCount = await w3.eth.getTransactionCount(account.address, 'pending');
    const confirmedCount = await w3.eth.getTransactionCount(account.address, 'latest');
    if (pendingCount > confirmedCount) {
      safeLog(chalk.yellow(`⚠ ${lang.pending}`), addLog);
      return false;
    }

    const tx = {
      from: account.address,
      to: w3.utils.toChecksumAddress(tokenAddress),
      data: tokenContract.methods
        .approve(w3.utils.toChecksumAddress(UNISWAP_V2_ROUTER_ADDRESS), amount)
        .encodeABI(),
      gas: 150000,
      gasPrice: await w3.eth.getGasPrice(),
      nonce: nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    safeLog(chalk.cyan(lang.debug(tx)), addLog);

    return await retryOn429(
      async () => {
        printStep('approve', lang.approving(tokenSymbol), addLog);
        const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        printStep('approve', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
        await sleep(2000); // Wait for confirmation
        printStep('approve', chalk.green(`✔ ${lang.approved(tokenSymbol)}`), addLog);
        return true;
      },
      addLog
    );
  } catch (e) {
    printStep('approve', chalk.red(lang.fail(e.message)), addLog);
    return false;
  }
}

// Swap MON to tokens
async function swapEthForTokens(w3, privateKey, tokenAddress, amountInWei, tokenSymbol, addLog) {
  const lang = translations;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const walletShort = account.address.slice(0, 8) + '...';
    const amountEth = w3.utils.fromWei(amountInWei, 'ether');

    safeLog(printHeader(lang.startSwapEth(amountEth, tokenSymbol, walletShort), chalk.blue), addLog);

    const monBalance = await w3.eth.getBalance(account.address);
    if (monBalance < amountInWei) {
      throw new Error(lang.insufficientMon(w3.utils.fromWei(monBalance, 'ether'), amountEth));
    }

    let nonce = await w3.eth.getTransactionCount(account.address, 'pending');
    const pendingCount = await w3.eth.getTransactionCount(account.address, 'pending');
    const confirmedCount = await w3.eth.getTransactionCount(account.address, 'latest');
    if (pendingCount > confirmedCount) {
      safeLog(chalk.yellow(`⚠ ${lang.pending}`), addLog);
      return false;
    }

    const router = new w3.eth.Contract(ROUTER_ABI, w3.utils.toChecksumAddress(UNISWAP_V2_ROUTER_ADDRESS));
    const tx = {
      from: account.address,
      to: w3.utils.toChecksumAddress(UNISWAP_V2_ROUTER_ADDRESS),
      value: amountInWei,
      data: router.methods
        .swapExactETHForTokens(
          0,
          [
            w3.utils.toChecksumAddress(WETH_ADDRESS),
            w3.utils.toChecksumAddress(tokenAddress),
          ],
          account.address,
          Math.floor(Date.now() / 1000) + 600
        )
        .encodeABI(),
      gas: 300000,
      gasPrice: await w3.eth.getGasPrice(),
      nonce: nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    safeLog(chalk.cyan(lang.debug(tx)), addLog);

    return await retryOn429(
      async () => {
        printStep('swap', lang.sending, addLog);
        const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        printStep('swap', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
        await sleep(2000); // Wait for confirmation
        printStep('swap', chalk.green(`✔ ${lang.success}`), addLog);
        return true;
      },
      addLog
    );
  } catch (e) {
    printStep('swap', chalk.red(lang.fail(e.message)), addLog);
    return false;
  }
}

// Swap tokens to MON
async function swapTokensForEth(w3, privateKey, tokenAddress, tokenSymbol, addLog) {
  const lang = translations;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const walletShort = account.address.slice(0, 8) + '...';

    safeLog(printHeader(lang.startSwapToken(tokenSymbol, walletShort), chalk.blue), addLog);

    const tokenContract = new w3.eth.Contract(ERC20_ABI, w3.utils.toChecksumAddress(tokenAddress));
    const balance = await tokenContract.methods.balanceOf(account.address).call();
    if (balance == 0) {
      printStep('swap', chalk.yellow(`⚠ ${lang.noBalance(tokenSymbol)}`), addLog);
      return false;
    }

    const approveSuccess = await approveToken(w3, privateKey, tokenAddress, balance, tokenSymbol, addLog);
    if (!approveSuccess) {
      return false;
    }

    let nonce = await w3.eth.getTransactionCount(account.address, 'pending');
    const pendingCount = await w3.eth.getTransactionCount(account.address, 'pending');
    const confirmedCount = await w3.eth.getTransactionCount(account.address, 'latest');
    if (pendingCount > confirmedCount) {
      safeLog(chalk.yellow(`⚠ ${lang.pending}`), addLog);
      return false;
    }

    const router = new w3.eth.Contract(ROUTER_ABI, w3.utils.toChecksumAddress(UNISWAP_V2_ROUTER_ADDRESS));
    const tx = {
      from: account.address,
      to: w3.utils.toChecksumAddress(UNISWAP_V2_ROUTER_ADDRESS),
      value: '0',
      data: router.methods
        .swapExactTokensForETH(
          balance,
          0,
          [
            w3.utils.toChecksumAddress(tokenAddress),
            w3.utils.toChecksumAddress(WETH_ADDRESS),
          ],
          account.address,
          Math.floor(Date.now() / 1000) + 600
        )
        .encodeABI(),
      gas: 300000,
      gasPrice: await w3.eth.getGasPrice(),
      nonce: nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    safeLog(chalk.cyan(lang.debug(tx)), addLog);

    return await retryOn429(
      async () => {
        printStep('swap', lang.sending, addLog);
        const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        printStep('swap', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
        await sleep(2000); // Wait for confirmation
        printStep('swap', chalk.green(`✔ ${lang.success}`), addLog);
        return true;
      },
      addLog
    );
  } catch (e) {
    printStep('swap', chalk.red(lang.fail(e.message)), addLog);
    return false;
  }
}

// Check balance
async function checkBalance(w3, privateKey, idx, totalAccounts, addLog) {
  const lang = translations;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const walletShort = account.address.slice(0, 8) + '...';

    safeLog(
      printHeader(lang.balanceHeader(idx, totalAccounts, walletShort), chalk.cyan),
      addLog
    );

    const monBalance = await w3.eth.getBalance(account.address);
    printStep(
      'balance',
      lang.balance('MON', w3.utils.fromWei(monBalance, 'ether')),
      addLog
    );

    for (const [symbol, address] of Object.entries(TOKEN_ADDRESSES)) {
      const tokenContract = new w3.eth.Contract(ERC20_ABI, w3.utils.toChecksumAddress(address));
      const balance = await tokenContract.methods.balanceOf(account.address).call();
      printStep(
        'balance',
        lang.balance(symbol, w3.utils.fromWei(balance, 'ether')),
        addLog
      );
    }
  } catch (e) {
    printStep('balance', chalk.red(lang.fail(e.message)), addLog);
  }
}

// Run swap cycle
async function runSwapCycle(w3, cycles, privateKeys, addLog, requestInput) {
  const lang = translations;
  for (let accountIdx = 1; accountIdx <= privateKeys.length; accountIdx++) {
    const privateKey = privateKeys[accountIdx - 1];
    const walletShort = w3.eth.accounts.privateKeyToAccount(privateKey).address.slice(0, 8) + '...';

    // Log account header using walletShort
    safeLog(
      printHeader(
        `${lang.account} ${accountIdx}/${privateKeys.length} | ${walletShort}`,
        chalk.blue
      ),
      addLog
    );
    await checkBalance(w3, privateKey, accountIdx, privateKeys.length, addLog);

    for (let cycle = 1; cycle <= cycles; cycle++) {
      const msg = lang.startCycle(cycle, cycles, accountIdx, privateKeys.length, walletShort);
      safeLog(printHeader(msg, chalk.cyan), addLog);
      safeUpdatePanel(chalk.cyan(msg), addLog);

      // Swap MON to tokens
      for (const [tokenSymbol, tokenAddress] of Object.entries(TOKEN_ADDRESSES)) {
        const ethAmount = getRandomEthAmount(w3);
        await swapEthForTokens(w3, privateKey, tokenAddress, ethAmount, tokenSymbol, addLog);
        await sleep(5000); // 5-second delay between swaps
      }

      // Swap tokens to MON
      safeLog(
        printHeader(`SWAPPING ALL TOKENS TO MON | ${walletShort}`, chalk.cyan),
        addLog
      );
      for (const [tokenSymbol, tokenAddress] of Object.entries(TOKEN_ADDRESSES)) {
        await swapTokensForEth(w3, privateKey, tokenAddress, tokenSymbol, addLog);
        await sleep(5000); // 5-second delay between swaps
      }

      if (cycle < cycles) {
        const delay = getRandomDelay();
        const minutes = (delay / 1000 / 60).toFixed(1);
        safeLog(chalk.yellow(lang.waitCycle(minutes)), addLog);
        safeUpdatePanel(chalk.yellow(lang.waitCycle(minutes)), addLog);
        await sleep(delay);
      }
    }

    if (accountIdx < privateKeys.length) {
      const delay = getRandomDelay();
      const minutes = (delay / 1000 / 60).toFixed(1);
      safeLog(chalk.yellow(lang.waitAccount(minutes)), addLog);
      safeUpdatePanel(chalk.yellow(lang.waitAccount(minutes)), addLog);
      await sleep(delay);
    }
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput) => {
  const w3 = await connectToRpc(addLog, updatePanel);
  const lang = translations;

  // Initialize contracts with checksum addresses
  const checksumTokenAddresses = Object.fromEntries(
    Object.entries(TOKEN_ADDRESSES).map(([key, value]) => [
      key,
      w3.utils.toChecksumAddress(value),
    ])
  );

  safeLog(printHeader(lang.title, chalk.green), addLog);
  safeUpdatePanel(chalk.green(`--- ${lang.title} ---`), updatePanel);

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys.length) {
    safeLog(chalk.red(`❌ pvkey.txt not found`), addLog);
    safeUpdatePanel(chalk.red(`❌ pvkey.txt not found`), updatePanel);
    return;
  }

  safeLog(chalk.cyan(`👥 ${lang.accounts}: ${privateKeys.length}`), addLog);
  safeUpdatePanel(chalk.cyan(`👥 ${lang.accounts}: ${privateKeys.length}`), updatePanel);

  const cycles = await getCycles(requestInput, addLog);
  const startMsg = `Running ${cycles} Uniswap swap cycles with random 1-3 minute delay for ${privateKeys.length} accounts...`;
  safeLog(chalk.yellow(`🚀 ${startMsg}`), addLog);
  safeUpdatePanel(chalk.yellow(`🚀 ${startMsg}`), updatePanel);

  await runSwapCycle(w3, cycles, privateKeys, addLog, requestInput);

  const completionMsg = `
${chalk.green(`--- ${lang.done(cycles, privateKeys.length)} ---`)}
`;
  safeLog(completionMsg, addLog);
  safeUpdatePanel(completionMsg, updatePanel);
};
