const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;
const axios = require('axios');

// Constants
const RPC_URLS = [
  'https://testnet-rpc.monad.xyz',
  'https://testnet-rpc.monorail.xyz',
  'https://monad-testnet.drpc.org',
];
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const FAUCET_ADDRESS = '0xF2B87A9C773f468D4C9d1172b8b2C713f9481b80';
const bmBTC = '0x0bb0aa6aa3a3fd4f7a43fb5e3d90bf9e6b4ef799';
const SPENDER_ADDRESS = '0x07c4b0db9c020296275dceb6381397ac58bbf5c7';
const ATTEMPTS = 3;
const PAUSE_BETWEEN_SWAPS = [5, 10];
const RANDOM_PAUSE_BETWEEN_ACTIONS = [5, 15];
const LEND = true;
const PERCENT_OF_BALANCE_TO_LEND = [20, 30];
const FAUCET_RETRY_DELAY = 300000; // 5 minutes in ms
const MIN_MON_BALANCE = '0.05'; // Minimum MON required for gas (in ether)
const MARKET_PARAMS = {
  loanToken: '0x01a4b3221e078106f9eb60c5303e3ba162f6a92e',
  collateralToken: bmBTC,
  oracle: '0x7c47e0c69fb30fe451da48185c78f0c508b3e5b8',
  irm: '0xc2d07bd8df5f33453e9ad4e77436b3eb70a09616',
  lltv: '900000000000000000', // 0.9 in wei
};

// ABIs
const TOKEN_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { internalType: 'address', name: 'spender', type: 'address' },
      { internalType: 'uint256', name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ internalType: 'bool', name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const FAUCET_ABI = [
  {
    inputs: [{ internalType: 'address', name: '_tokenAddress', type: 'address' }],
    name: 'getTokens',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const LENDING_ABI = [
  {
    type: 'function',
    name: 'supplyCollateral',
    inputs: [
      {
        name: 'marketParams',
        type: 'tuple',
        components: [
          { name: 'loanToken', type: 'address' },
          { name: 'collateralToken', type: 'address' },
          { name: 'oracle', type: 'address' },
          { name: 'irm', type: 'address' },
          { name: 'lltv', type: 'uint256' },
        ],
      },
      { name: 'assets', type: 'uint256' },
      { name: 'onBehalf', type: 'address' },
      { name: 'data', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
];

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

// Generate random pause
const getRandomPause = (range) => randomInRange(range[0], range[1]) * 1000;

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

// Prompt user input
const promptUser = async (message, requestInput) => {
  if (typeof requestInput === 'function') {
    return await requestInput(message);
  }
  return null; // Fallback for non-interactive mode
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
  title: 'BIMA DEPOSIT - MONAD TESTNET',
  accounts: 'Accounts',
  account: 'ACCOUNT',
  startMsg: (accounts) => `Starting Bima deposit for ${accounts} accounts`,
  done: (accounts, success) => `ALL DONE - ${accounts} ACCOUNTS, ${success} SUCCESSFUL`,
  login: 'Logging in to Bima',
  loginSuccess: 'Login successful!',
  faucet: 'Requesting tokens from faucet',
  faucetSuccess: 'Tokens received!',
  faucetEmpty: 'Faucet is empty (0 bmBTC). Check https://t.me/thogairdrops for updates or manually acquire bmBTC.',
  faucetLimit: 'Daily faucet limit reached, try again in 24 hours',
  faucetPrompt: 'Faucet is empty. Enter "retry" to wait 5 minutes, "skip" to continue, or "exit" to stop:',
  faucetManual: 'Manually send bmBTC to your wallet (0x0f00aD...) using Metamask or another wallet.',
  approve: (amount) => `Approving ${amount} bmBTC`,
  approveSuccess: 'Approved!',
  lend: 'Supplying collateral',
  lendSuccess: 'Successfully supplied!',
  balance: (amount) => `Balance: ${amount} bmBTC`,
  monBalance: (amount) => `Wallet MON: ${amount} MON`,
  insufficientMon: (balance) => `❌ Insufficient MON: ${balance} MON. Fund at https://testnet.monad.xyz/ or https://t.me/thogairdrops`,
  tx: (txHash) => `🔗 Tx: ${EXPLORER_URL}${txHash}`,
  fail: (error) => `❌ Failed: ${error}`,
  waitAccount: (seconds) => `⏳ Waiting ${seconds}s before next account...`,
  faucetRetry: (minutes) => `⏳ Faucet empty, retrying in ${minutes} minutes...`,
};

// Print header (no square borders)
function printHeader(text, color = chalk.cyan) {
  return `${color(`--- ${text} ---`)}`;
}

// Print step
function printStep(step, message, addLog) {
  const steps = {
    login: 'Login',
    faucet: 'Faucet',
    approve: 'Approve',
    lend: 'Lend',
    balance: 'Balance',
    monBalance: 'MON Balance',
  };
  const stepText = steps[step];
  safeLog(`${chalk.yellow('➤')} ${chalk.cyan(stepText.padEnd(15))} | ${message}`, addLog);
}

// Retry on 429 errors
async function retryOn429(operation, addLog, maxRetries = 3, baseDelay = 2000) {
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

// Bima class
class Bima {
  constructor(accountIndex, privateKey, w3) {
    this.accountIndex = accountIndex;
    this.privateKey = privateKey;
    this.w3 = w3;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.walletShort = this.account.address.slice(0, 8) + '...';
  }

  async login(addLog) {
    const lang = translations;
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        printStep('login', lang.login, addLog);
        const { message, timestamp } = await this._getNonce(addLog);
        if (!message) {
          throw new Error('Message to sign is empty');
        }

        const signature = await this.w3.eth.accounts.sign(message, this.privateKey);
        const headers = this._getHeaders();
        const jsonData = { signature: signature.signature, timestamp: parseInt(timestamp) };

        const response = await retryOn429(
          async () => {
            const res = await axios.post(
              'https://mainnet-api-v1.bima.money/bima/wallet/connect',
              jsonData,
              { headers }
            );
            return res;
          },
          addLog
        );

        if (response.status === 200) {
          printStep('login', chalk.green(`✔ ${lang.loginSuccess}`), addLog);
          return true;
        }
      } catch (e) {
        await this._handleError('login', e, addLog);
      }
    }
    printStep('login', chalk.red(`✘ ${lang.fail(`Login failed after ${ATTEMPTS} attempts`)}`), addLog);
    return false;
  }

  async getFaucetTokens(addLog, requestInput) {
    const lang = translations;
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        if (!(await this.login(addLog))) {
          throw new Error('Failed to login to Bima');
        }

        printStep('faucet', lang.faucet, addLog);

        // Check faucet bmBTC balance
        const tokenContract = new this.w3.eth.Contract(TOKEN_ABI, this.w3.utils.toChecksumAddress(bmBTC));
        const faucetBalance = await tokenContract.methods.balanceOf(FAUCET_ADDRESS).call();
        if (faucetBalance == 0) {
          printStep('faucet', chalk.red(`✘ ${lang.faucetEmpty}`), addLog);
          printStep('faucet', chalk.yellow(lang.faucetManual), addLog);
          if (retry < ATTEMPTS - 1) {
            const input = await promptUser(lang.faucetPrompt, requestInput);
            if (input && input.toLowerCase() === 'retry') {
              const minutes = (FAUCET_RETRY_DELAY / 1000 / 60).toFixed(1);
              printStep('faucet', chalk.yellow(lang.faucetRetry(minutes)), addLog);
              await sleep(FAUCET_RETRY_DELAY);
              continue;
            } else if (input && input.toLowerCase() === 'exit') {
              printStep('faucet', chalk.red(`✘ Exiting due to empty faucet`), addLog);
              return false;
            }
            // If 'skip' or no input, proceed to check wallet balance
            return false;
          }
          return false;
        }
        printStep('faucet', chalk.cyan(`Faucet balance: ${this.w3.utils.fromWei(faucetBalance, 'ether')} bmBTC`), addLog);

        // Check MON balance
        const monBalance = await this.w3.eth.getBalance(this.account.address);
        if (monBalance < this.w3.utils.toWei(MIN_MON_BALANCE, 'ether')) {
          printStep('faucet', chalk.red(lang.insufficientMon(this.w3.utils.fromWei(monBalance, 'ether'))), addLog);
          return false;
        }
        printStep('faucet', chalk.cyan(lang.monBalance(this.w3.utils.fromWei(monBalance, 'ether'))), addLog);

        // Build and send transaction
        const contract = new this.w3.eth.Contract(FAUCET_ABI, this.w3.utils.toChecksumAddress(FAUCET_ADDRESS));
        const tx = {
          from: this.account.address,
          to: this.w3.utils.toChecksumAddress(FAUCET_ADDRESS),
          data: contract.methods.getTokens(this.w3.utils.toChecksumAddress(bmBTC)).encodeABI(),
          gas: 150000,
          gasPrice: await this.w3.eth.getGasPrice(),
          nonce: await this.w3.eth.getTransactionCount(this.account.address, 'pending'),
          chainId: 10143,
        };

        // Check for pending transactions
        const pendingCount = await this.w3.eth.getTransactionCount(this.account.address, 'pending');
        const confirmedCount = await this.w3.eth.getTransactionCount(this.account.address, 'latest');
        if (pendingCount > confirmedCount) {
          printStep('faucet', chalk.yellow(`⚠ Pending transaction detected, skipping...`), addLog);
          return false;
        }

        // Simulate transaction
        try {
          await this.w3.eth.call(tx);
        } catch (e) {
          if (e.message.includes('reverted')) {
            printStep('faucet', chalk.yellow(`⚠ ${lang.faucetLimit}`), addLog);
            return false;
          }
          throw e;
        }

        return await retryOn429(
          async () => {
            printStep('faucet', 'Sending transaction...', addLog);
            const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.privateKey);
            const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);
            printStep('faucet', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
            await sleep(2000); // Wait for confirmation
            printStep('faucet', chalk.green(`✔ ${lang.faucetSuccess}`), addLog);
            return true;
          },
          addLog
        );
      } catch (e) {
        await this._handleError('faucet', e, addLog);
      }
    }
    printStep('faucet', chalk.red(`✘ ${lang.fail(`Faucet failed after ${ATTEMPTS} attempts`)}`), addLog);
    return false;
  }

  async approveToken(amount, addLog) {
    const lang = translations;
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        printStep('approve', lang.approve(this.w3.utils.fromWei(amount, 'ether')), addLog);
        const contract = new this.w3.eth.Contract(TOKEN_ABI, this.w3.utils.toChecksumAddress(bmBTC));
        const tx = {
          from: this.account.address,
          to: this.w3.utils.toChecksumAddress(bmBTC),
          data: contract.methods
            .approve(this.w3.utils.toChecksumAddress(SPENDER_ADDRESS), amount.toString())
            .encodeABI(),
          gas: 200000, // Increased from 150000
          gasPrice: await this.w3.eth.getGasPrice(),
          nonce: await this.w3.eth.getTransactionCount(this.account.address, 'pending'),
          chainId: 10143,
        };

        // Check for pending transactions
        const pendingCount = await this.w3.eth.getTransactionCount(this.account.address, 'pending');
        const confirmedCount = await this.w3.eth.getTransactionCount(this.account.address, 'latest');
        if (pendingCount > confirmedCount) {
          printStep('approve', chalk.yellow(`⚠ Pending transaction detected, skipping...`), addLog);
          return false;
        }

        return await retryOn429(
          async () => {
            printStep('approve', 'Sending transaction...', addLog);
            const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.privateKey);
            const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);
            printStep('approve', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
            await sleep(2000); // Wait for confirmation
            printStep('approve', chalk.green(`✔ ${lang.approveSuccess}`), addLog);
            return true;
          },
          addLog
        );
      } catch (e) {
        await this._handleError('approve', e, addLog);
      }
    }
    printStep('approve', chalk.red(`✘ ${lang.fail(`Approval failed after ${ATTEMPTS} attempts`)}`), addLog);
    return false;
  }

  async supplyCollateral(amount, addLog) {
    const lang = translations;
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        printStep('lend', lang.lend, addLog);
        const contract = new this.w3.eth.Contract(LENDING_ABI, this.w3.utils.toChecksumAddress(SPENDER_ADDRESS));
        const tx = {
          from: this.account.address,
          to: this.w3.utils.toChecksumAddress(SPENDER_ADDRESS),
          data: contract.methods
            .supplyCollateral(
              [
                this.w3.utils.toChecksumAddress(MARKET_PARAMS.loanToken),
                this.w3.utils.toChecksumAddress(MARKET_PARAMS.collateralToken),
                this.w3.utils.toChecksumAddress(MARKET_PARAMS.oracle),
                this.w3.utils.toChecksumAddress(MARKET_PARAMS.irm),
                MARKET_PARAMS.lltv,
              ],
              amount.toString(),
              this.account.address,
              '0x'
            )
            .encodeABI(),
          gas: 300000,
          gasPrice: await this.w3.eth.getGasPrice(),
          nonce: await this.w3.eth.getTransactionCount(this.account.address, 'pending'),
          chainId: 10143,
        };

        // Check for pending transactions
        const pendingCount = await this.w3.eth.getTransactionCount(this.account.address, 'pending');
        const confirmedCount = await this.w3.eth.getTransactionCount(this.account.address, 'latest');
        if (pendingCount > confirmedCount) {
          printStep('lend', chalk.yellow(`⚠ Pending transaction detected, skipping...`), addLog);
          return false;
        }

        return await retryOn429(
          async () => {
            printStep('lend', 'Sending transaction...', addLog);
            const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.privateKey);
            const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);
            printStep('lend', chalk.yellow(lang.tx(txHash.transactionHash)), addLog);
            await sleep(2000); // Wait for confirmation
            printStep('lend', chalk.green(`✔ ${lang.lendSuccess}`), addLog);
            return true;
          },
          addLog
        );
      } catch (e) {
        await this._handleError('lend', e, addLog);
      }
    }
    printStep('lend', chalk.red(`✘ ${lang.fail(`Lending failed after ${ATTEMPTS} attempts`)}`), addLog);
    return false;
  }

  async lend(addLog) {
    const lang = translations;
    if (!LEND) {
      printStep('lend', chalk.yellow(`⚠ Lending is disabled`), addLog);
      return false;
    }

    try {
      safeLog(printHeader(`LENDING OPERATION - ${this.walletShort}`, chalk.blue), addLog);

      // Check MON balance
      const monBalance = await this.w3.eth.getBalance(this.account.address);
      if (monBalance < this.w3.utils.toWei(MIN_MON_BALANCE, 'ether')) {
        printStep('monBalance', chalk.red(lang.insufficientMon(this.w3.utils.fromWei(monBalance, 'ether'))), addLog);
        return false;
      }
      printStep('monBalance', chalk.cyan(lang.monBalance(this.w3.utils.fromWei(monBalance, 'ether'))), addLog);

      // Check bmBTC balance
      const tokenContract = new this.w3.eth.Contract(TOKEN_ABI, this.w3.utils.toChecksumAddress(bmBTC));
      const balance = await tokenContract.methods.balanceOf(this.account.address).call();
      if (balance == 0) {
        throw new Error('Token balance is 0');
      }

      printStep('balance', chalk.cyan(lang.balance(this.w3.utils.fromWei(balance, 'ether'))), addLog);
      const amountToLend = this._calculateLendAmount(balance);

      // Approve tokens
      const approveSuccess = await this.approveToken(amountToLend, addLog);
      if (!approveSuccess) {
        return false;
      }
      await sleep(getRandomPause(PAUSE_BETWEEN_SWAPS));

      // Supply collateral
      return await this.supplyCollateral(amountToLend, addLog);
    } catch (e) {
      printStep('lend', chalk.red(lang.fail(e.message)), addLog);
      return false;
    }
  }

  async _getNonce(addLog) {
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        const response = await retryOn429(
          async () => {
            return await axios.get('https://mainnet-api-v1.bima.money/bima/wallet/tip_info', {
              headers: this._getHeaders(),
            });
          },
          addLog
        );
        return {
          message: response.data.data.tip_info,
          timestamp: response.data.data.timestamp,
        };
      } catch (e) {
        await this._handleError('_getNonce', e, addLog);
      }
    }
    return { message: '', timestamp: '' };
  }

  _getHeaders() {
    return {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'fr-CH,fr;q=0.9,en-US;q=0.8,en;q=0.7',
      Connection: 'keep-alive',
      'Content-Type': 'application/json',
      Origin: 'https://bima.money',
      Referer: 'https://bima.money/',
      'Sec-Fetch-Dest': 'empty',
      'Sec-Fetch-Mode': 'cors',
      'Sec-Fetch-Site': 'same-site',
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36',
      address: this.account.address,
      'sec-ch-ua': '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    };
  }

  _calculateLendAmount(balance) {
    const percent = randomInRange(PERCENT_OF_BALANCE_TO_LEND[0], PERCENT_OF_BALANCE_TO_LEND[1]);
    const amount = this.w3.utils.toBN(balance).muln(percent).divn(100);
    return amount.toString();
  }

  async _handleError(action, error, addLog) {
    const pause = getRandomPause(RANDOM_PAUSE_BETWEEN_ACTIONS);
    let errorMsg = `Error in ${action}: ${error.message}`;
    if (error.message.includes('insufficient')) {
      errorMsg = `Error in ${action}: Insufficient MON balance for gas. Fund at https://testnet.monad.xyz/ or https://t.me/thogairdrops`;
    }
    printStep(action, chalk.red(`${errorMsg}. Retrying in ${(pause / 1000).toFixed(2)}s`), addLog);
    await sleep(pause);
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput) => {
  const w3 = await connectToRpc(addLog, updatePanel);
  const lang = translations;

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

  const startMsg = lang.startMsg(privateKeys.length);
  safeLog(chalk.yellow(`🚀 ${startMsg}`), addLog);
  safeUpdatePanel(chalk.yellow(`🚀 ${startMsg}`), updatePanel);

  let successCount = 0;
  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const bima = new Bima(idx + 1, privateKey, w3);
    const accountMsg = `${lang.account} ${idx + 1}/${privateKeys.length} | ${bima.walletShort}`;
    safeLog(printHeader(accountMsg, chalk.blue), addLog);

    // Check bmBTC balance
    const tokenContract = new w3.eth.Contract(TOKEN_ABI, w3.utils.toChecksumAddress(bmBTC));
    const walletBalance = await tokenContract.methods.balanceOf(bima.account.address).call();
    printStep('balance', chalk.cyan(lang.balance(w3.utils.fromWei(walletBalance, 'ether'))), addLog);

    // Get tokens if balance is 0
    if (walletBalance == 0) {
      const faucetSuccess = await bima.getFaucetTokens(addLog, requestInput);
      if (!faucetSuccess) {
        continue;
      }
    } else {
      printStep('faucet', chalk.yellow(`⚠ Wallet has ${w3.utils.fromWei(walletBalance, 'ether')} bmBTC, skipping faucet`), addLog);
    }

    // Perform lending
    if (await bima.lend(addLog)) {
      successCount++;
    }

    // Pause between accounts
    if (idx < privateKeys.length - 1) {
      const pause = getRandomPause([10, 30]);
      const seconds = (pause / 1000).toFixed(2);
      safeLog(chalk.yellow(lang.waitAccount(seconds)), addLog);
      safeUpdatePanel(chalk.yellow(lang.waitAccount(seconds)), updatePanel);
      await sleep(pause);
    }
  }

  const completionMsg = `
${chalk.green(`--- ${lang.done(privateKeys.length, successCount)} ---`)}
`;
  safeLog(completionMsg, addLog);
  safeUpdatePanel(completionMsg, updatePanel);
};
