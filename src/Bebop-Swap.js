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
const WMON_CONTRACT = '0x760AfE86e5de5fa0ee542fc7B7b713e1c5425701'; // Checksum format

// Smart contract ABI
const contractAbi = [
  {
    constant: false,
    inputs: [],
    name: 'deposit',
    outputs: [],
    payable: true,
    stateMutability: 'payable',
    type: 'function',
  },
  {
    constant: false,
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    payable: false,
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    constant: true,
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

// Generate random delay (60–180 seconds)
function getRandomDelay() {
  return randomInRange(60, 180) * 1000; // Return milliseconds
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
  title: 'BEBOP SWAP - MONAD TESTNET',
  accounts: 'Accounts',
  account: 'ACCOUNT',
  cyclesPrompt: 'Enter number of cycles (default 1): ',
  cyclesError: 'Number must be > 0 / Enter a valid number!',
  amountPrompt: 'Enter MON amount (0.01 - 999, e.g., 0.1 or 1): ',
  amountError: 'Amount must be 0.01-999 / Enter a valid number!',
  startCycle: (cycle, total, wallet) => `CYCLE ${cycle}/${total} | Account: ${wallet}`,
  startWrap: (amount, wallet) => `Wrap ${amount} MON → WMON | ${wallet}`,
  startUnwrap: (amount, wallet) => `Unwrap ${amount} WMON → MON | ${wallet}`,
  sending: 'Sending transaction...',
  tx: (txHash) => `🔗 Tx: ${EXPLORER_URL}${txHash}`,
  successWrap: '✅ Wrap successful!',
  successUnwrap: '✅ Unwrap successful!',
  fail: (error) => `❌ Failed: ${error}`,
  wait: (seconds) => `⏳ Waiting ${seconds} seconds...`,
  done: (count) => `ALL DONE - ${count} ACCOUNTS`,
  pending: '⚠ Pending transaction detected, skipping this wallet...',
  insufficientWMON: (balance) => `❌ Insufficient WMON balance: ${balance} WMON`,
  debug: (tx) => `Transaction details: To=${tx.to}, Value=${tx.value || 0}, Data=${tx.data ? tx.data.slice(0, 50) + '...' : 'none'}`,
};

// Print header (no square borders)
function printHeader(text, color = chalk.cyan) {
  return `${color(`--- ${text} ---`)}`;
}

// Print step
function printStep(step, message, addLog) {
  const steps = { wrap: 'Wrap MON', unwrap: 'Unwrap WMON' };
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

// Get MON amount from user
async function getMonAmount(requestInput, addLog, w3) {
  const lang = translations;
  while (true) {
    safeLog(printHeader('MON AMOUNT', chalk.yellow), addLog);
    const input = await requestInput(chalk.green('➤ ') + lang.amountPrompt);
    try {
      const amount = parseFloat(input.trim());
      if (amount >= 0.01 && amount <= 999) {
        return w3.utils.toWei(amount.toString(), 'ether');
      }
      safeLog(chalk.red(`❌ ${lang.amountError}`), addLog);
    } catch (e) {
      safeLog(chalk.red(`❌ ${lang.amountError}`), addLog);
    }
  }
}

// Wrap MON to WMON
async function wrapMon(w3, contract, privateKey, amount, addLog, maxRetries = 3) {
  const lang = translations;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const walletShort = account.address.slice(0, 8) + '...';
    const amountEth = w3.utils.fromWei(amount, 'ether');

    safeLog(printHeader(lang.startWrap(amountEth, walletShort), chalk.blue), addLog);

    let nonce = await w3.eth.getTransactionCount(account.address, 'pending');
    const pendingCount = await w3.eth.getTransactionCount(account.address, 'pending');
    const confirmedCount = await w3.eth.getTransactionCount(account.address, 'latest');
    if (pendingCount > confirmedCount) {
      safeLog(chalk.yellow(`⚠ ${lang.pending}`), addLog);
      return false;
    }

    const tx = {
      from: account.address,
      to: w3.utils.toChecksumAddress(WMON_CONTRACT),
      value: amount,
      data: contract.methods.deposit().encodeABI(),
      gas: 500000,
      gasPrice: w3.utils.toWei('100', 'gwei'),
      nonce: nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    safeLog(chalk.cyan(lang.debug(tx)), addLog);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        printStep('wrap', lang.sending, addLog);
        const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        printStep('wrap', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
        await sleep(1000); // Wait for confirmation
        printStep('wrap', chalk.green(lang.successWrap), addLog);
        return true;
      } catch (e) {
        if (e.message.includes('nonce too(low')) {
          nonce++;
          tx.nonce = nonce;
          safeLog(chalk.yellow(`⚠ Nonce too low, incrementing to ${nonce} and retrying...`), addLog);
        } else if (e.message.includes('revert') && attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(chalk.yellow(`⚠ Transaction failed, retrying in ${delay / 1000}s: ${e.message}`), addLog);
          await sleep(delay);
          tx.gas = Math.min(tx.gas + 100000, 600000);
        } else {
          printStep('wrap', chalk.red(lang.fail(e.message)), addLog);
          return false;
        }
      }
    }
    return false;
  } catch (e) {
    printStep('wrap', chalk.red(lang.fail(e.message)), addLog);
    return false;
  }
}

// Unwrap WMON to MON
async function unwrapMon(w3, contract, privateKey, amount, addLog, maxRetries = 3) {
  const lang = translations;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const walletShort = account.address.slice(0, 8) + '...';
    const amountEth = w3.utils.fromWei(amount, 'ether');

    safeLog(printHeader(lang.startUnwrap(amountEth, walletShort), chalk.blue), addLog);

    // Check WMON balance
    const wmonBalance = await contract.methods.balanceOf(account.address).call();
    if (wmonBalance < amount) {
      safeLog(chalk.red(lang.insufficientWMON(w3.utils.fromWei(wmonBalance, 'ether'))), addLog);
      return false;
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
      to: w3.utils.toChecksumAddress(WMON_CONTRACT),
      value: '0', // Explicitly set to 0
      data: contract.methods.withdraw(amount).encodeABI(),
      gas: 500000,
      gasPrice: w3.utils.toWei('50', 'gwei'),
      nonce: nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    safeLog(chalk.cyan(lang.debug(tx)), addLog);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        printStep('unwrap', lang.sending, addLog);
        const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        printStep('unwrap', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
        await sleep(1000); // Wait for confirmation
        printStep('unwrap', chalk.green(lang.successUnwrap), addLog);
        return true;
      } catch (e) {
        if (e.message.includes('nonce too low')) {
          nonce++;
          tx.nonce = nonce;
          safeLog(chalk.yellow(`⚠ Nonce too low, incrementing to ${nonce} and retrying...`), addLog);
        } else if (e.message.includes('revert') && attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(chalk.yellow(`⚠ Transaction failed, retrying in ${delay / 1000}s: ${e.message}`), addLog);
          await sleep(delay);
          tx.gas = Math.min(tx.gas + 100000, 600000);
        } else {
          printStep('unwrap', chalk.red(lang.fail(e.message)), addLog);
          return false;
        }
      }
    }
    return false;
  } catch (e) {
    printStep('unwrap', chalk.red(lang.fail(e.message)), addLog);
    return false;
  }
}

// Run swap cycle
async function runSwapCycle(w3, contract, cycles, privateKeys, addLog, requestInput) {
  const lang = translations;
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const pk of privateKeys) {
      const walletShort = w3.eth.accounts.privateKeyToAccount(pk).address.slice(0, 8) + '...';
      const msg = lang.startCycle(cycle, cycles, walletShort);
      safeLog(printHeader(msg, chalk.cyan), addLog);
      safeUpdatePanel(chalk.cyan(msg), addLog);

      const amount = await getMonAmount(requestInput, addLog, w3);
      await wrapMon(w3, contract, pk, amount, addLog);
      await unwrapMon(w3, contract, pk, amount, addLog);

      if (cycle < cycles || pk !== privateKeys[privateKeys.length - 1]) {
        const delay = getRandomDelay();
        const seconds = Math.round(delay / 1000);
        safeLog(chalk.yellow(lang.wait(seconds)), addLog);
        safeUpdatePanel(chalk.yellow(lang.wait(seconds)), addLog);
        await sleep(delay);
      }
    }
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput) => {
  const w3 = await connectToRpc(addLog, updatePanel);
  const lang = translations;

  // Initialize contract
  const contract = new w3.eth.Contract(contractAbi, w3.utils.toChecksumAddress(WMON_CONTRACT));

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
  const startMsg = `Running ${cycles} swap cycles...`;
  safeLog(chalk.yellow(`🚀 ${startMsg}`), addLog);
  safeUpdatePanel(chalk.yellow(`🚀 ${startMsg}`), updatePanel);

  await runSwapCycle(w3, contract, cycles, privateKeys, addLog, requestInput);

  const completionMsg = `
${chalk.green(`--- ${lang.done(privateKeys.length)} ---`)}
`;
  safeLog(completionMsg, addLog);
  safeUpdatePanel(completionMsg, updatePanel);
};
