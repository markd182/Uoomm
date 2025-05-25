const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const NFT_CONTRACT_ADDRESS = '0xb33D7138c53e516871977094B249C8f2ab89a4F4';
const BORDER_WIDTH = 80;
const ATTEMPTS = 3;
const PAUSE_BETWEEN_ACTIONS = [5, 15];
const MAX_AMOUNT_FOR_EACH_ACCOUNT = [1, 3];
const MIN_MON_BALANCE = '0.05'; // Minimum MON for gas (in ether)

// ABI for ERC1155 contract
const ERC1155_ABI = [
  {
    inputs: [
      { internalType: 'address', name: 'account', type: 'address' },
      { internalType: 'uint256', name: 'id', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'uint256', name: 'quantity', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ internalType: 'address', name: '', type: 'address' }],
    name: 'mintedCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;
const getRandomPause = (range) => randomInRange(range[0], range[1]) * 1000;

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

// Print border
function printBorder(text, color = chalk.cyan, width = BORDER_WIDTH) {
  text = text.trim();
  if (text.length > width - 4) {
    text = text.slice(0, width - 7) + '...';
  }
  const paddedText = ` ${text} `.padEnd(width - 2, ' ').padStart(width - 2, ' ');
  return `${color}--- ${paddedText} ---`;
}

// Print step
function printStep(step, message, lang, addLog) {
  const steps = {
    en: {
      balance: 'BALANCE',
      mint: 'MINT NFT',
      monBalance: 'MON BALANCE',
    },
  };
  const stepText = steps[lang][step] || step;
  const formattedStep = `${chalk.yellow('➤')} ${chalk.cyan(stepText.padEnd(15))} | ${message}`;
  safeLog(formattedStep, addLog);
}

// Language translations
const translations = {
  title: 'LILCHOGSTARS MINT - MONAD TESTNET',
  accounts: 'Accounts',
  account: 'ACCOUNT',
  startMsg: (accounts) => `Starting Lilchogstars mint for ${accounts} accounts`,
  done: (accounts, success) => `ALL DONE - ${accounts} ACCOUNTS, ${success} SUCCESSFUL`,
  balance: (amount) => `Current NFT balance: ${amount}`,
  monBalance: (amount) => `Wallet MON: ${amount} MON`,
  insufficientMon: (balance) => `❌ Insufficient MON: ${balance} MON. Fund at https://testnet.monad.xyz/ or https://t.me/thogairdrops`,
  mint: 'Minting Lilchogstars NFT',
  mintSuccess: 'Successfully minted!',
  mintAlready: (balance) => `Already minted: ${balance} NFTs`,
  tx: (txHash) => `🔗 Tx: ${EXPLORER_URL}${txHash}`,
  fail: (error) => `❌ Failed: ${error}`,
  waitAccount: (seconds) => `⏳ Waiting ${seconds}s before next account...`,
};

// Lilchogstars class
class Lilchogstars {
  constructor(accountIndex, privateKey, w3) {
    this.accountIndex = accountIndex;
    this.privateKey = privateKey;
    this.w3 = w3;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.walletShort = this.account.address.slice(0, 8) + '...';
    this.nftContract = new w3.eth.Contract(ERC1155_ABI, w3.utils.toChecksumAddress(NFT_CONTRACT_ADDRESS));
    this.language = 'en';
  }

  async getNftBalance(addLog) {
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        const balance = await this.nftContract.methods.mintedCount(this.account.address).call();
        safeLog(`[${this.accountIndex}] NFT balance: ${balance}`, addLog);
        return parseInt(balance);
      } catch (e) {
        await this._handleError('get_nft_balance', e, addLog);
      }
    }
    throw new Error('Failed to get NFT balance after retries');
  }

  async mint(addLog) {
    const lang = translations;
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        const balance = await this.getNftBalance(addLog);
        const randomAmount = Math.floor(randomInRange(MAX_AMOUNT_FOR_EACH_ACCOUNT[0], MAX_AMOUNT_FOR_EACH_ACCOUNT[1]));

        printStep(
          'balance',
          lang.balance(`${chalk.cyan(`${balance} / Target: ${randomAmount}`)}`),
          this.language,
          addLog
        );

        if (balance >= randomAmount) {
          printStep('mint', chalk.green(`✔ ${lang.mintAlready(balance)}`), this.language, addLog);
          return true;
        }

        // Check MON balance
        const monBalance = await this.w3.eth.getBalance(this.account.address);
        const minMonBalance = this.w3.utils.toWei(MIN_MON_BALANCE, 'ether');
        if (monBalance < minMonBalance) {
          printStep(
            'monBalance',
            chalk.red(lang.insufficientMon(this.w3.utils.fromWei(monBalance, 'ether'))),
            this.language,
            addLog
          );
          return false;
        }
        printStep(
          'monBalance',
          chalk.cyan(lang.monBalance(this.w3.utils.fromWei(monBalance, 'ether'))),
          this.language,
          addLog
        );

        printStep('mint', lang.mint, this.language, addLog);

        const latestBlock = await this.w3.eth.getBlock('latest');
        const baseFee = latestBlock.baseFeePerGas || 0;
        const gasPrice = await this.w3.eth.getGasPrice();
        const tx = {
          from: this.account.address,
          to: this.w3.utils.toChecksumAddress(NFT_CONTRACT_ADDRESS),
          data: this.nftContract.methods.mint(1).encodeABI(),
          value: '0',
          gas: 200000,
          maxFeePerGas: Math.floor((baseFee + parseInt(gasPrice)) * 1.2),
          maxPriorityFeePerGas: Math.floor(parseInt(gasPrice) * 0.1),
          nonce: await this.w3.eth.getTransactionCount(this.account.address, 'pending'),
          chainId: 10143,
          type: '0x2',
        };

        // Check pending transactions
        const pendingCount = await this.w3.eth.getTransactionCount(this.account.address, 'pending');
        const confirmedCount = await this.w3.eth.getTransactionCount(this.account.address, 'latest');
        if (pendingCount > confirmedCount) {
          printStep('mint', chalk.yellow(`⚠ Pending transaction detected, skipping...`), this.language, addLog);
          return false;
        }

        // Simulate transaction
        try {
          await this.w3.eth.call(tx);
        } catch (e) {
          if (e.message.includes('reverted')) {
            printStep('mint', chalk.red(`✘ ${lang.fail('Transaction reverted by contract')}`), this.language, addLog);
            return false;
          }
          throw e;
        }

        printStep('mint', 'Sending transaction...', this.language, addLog);
        const signedTx = await this.w3.eth.accounts.signTransaction(tx, this.privateKey);
        const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        if (txHash.status) {
          printStep(
            'mint',
            chalk.green(`✔ ${lang.mintSuccess} ${lang.tx(txHash.transactionHash)}`),
            this.language,
            addLog
          );
          safeLog(`[${this.accountIndex}] Successfully minted NFT. TX: ${EXPLORER_URL}${txHash.transactionHash}`, addLog);
          return true;
        } else {
          printStep(
            'mint',
            chalk.red(`✘ ${lang.fail(`Mint failed: ${EXPLORER_URL}${txHash.transactionHash}`)}`),
            this.language,
            addLog
          );
          safeLog(`[${this.accountIndex}] Mint failed. TX: ${EXPLORER_URL}${txHash.transactionHash}`, addLog);
          return false;
        }
      } catch (e) {
        await this._handleError('mint', e, addLog);
      }
    }
    printStep('mint', chalk.red(`✘ ${lang.fail(`Mint failed after ${ATTEMPTS} attempts`)}`), this.language, addLog);
    return false;
  }

  async _handleError(action, error, addLog) {
    const pause = getRandomPause(PAUSE_BETWEEN_ACTIONS);
    let errorMsg = `Error in ${action}: ${error.message}`;
    if (error.message.includes('insufficient')) {
      errorMsg = `Error in ${action}: Insufficient MON balance for gas. Fund at https://testnet.monad.xyz/ or https://t.me/thogairdrops`;
    } else if (error.message.includes('getMaxPriorityFeePerGas')) {
      errorMsg = `Error in ${action}: Incompatible web3.js version. Please update to >=1.3.0 or use fallback gas settings.`;
    }
    safeLog(`[${this.accountIndex}] ${errorMsg}`, addLog);
    printStep(action, chalk.red(`${errorMsg}. Retrying in ${(pause / 1000).toFixed(2)}s`), this.language, addLog);
    await sleep(pause);
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput) => {
  const w3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));
  const lang = translations;

  // Log web3.js version for debugging
  safeLog(chalk.blue(`🛠 Using web3.js version: ${require('web3/package.json').version}`), addLog);

  try {
    await w3.eth.getBlockNumber();
    safeLog(chalk.blue(`🪫 Connected to RPC: ${RPC_URL}`), addLog);
  } catch (e) {
    const errorMsg = chalk.red(`❌ Unable to connect to RPC: ${e.message}`);
    safeLog(errorMsg, addLog);
    safeUpdatePanel(errorMsg, updatePanel);
    return;
  }

  let privateKeys = [];
  try {
    const data = await fs.readFile('pvkey.txt', 'utf8');
    privateKeys = data
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line);
    if (!privateKeys.length) {
      throw new Error('pvkey.txt is empty');
    }
  } catch (e) {
    const errorMsg = chalk.red(`❌ Error reading pvkey.txt: ${e.message}`);
    safeLog(errorMsg, addLog);
    safeUpdatePanel(errorMsg, updatePanel);
    return;
  }

  safeLog(chalk.green(`--- ${lang.title} ---`), addLog);
  safeUpdatePanel(chalk.green(`--- ${lang.title} ---`), updatePanel);

  safeLog(chalk.cyan(`👥 ${lang.accounts}: ${privateKeys.length}`), addLog);
  safeUpdatePanel(chalk.cyan(`👥 ${lang.accounts}: ${privateKeys.length}`), updatePanel);

  const startMsg = lang.startMsg(privateKeys.length);
  safeLog(chalk.yellow(`🚀 ${startMsg}`), addLog);
  safeUpdatePanel(chalk.yellow(`🚀 ${startMsg}`), updatePanel);

  let successCount = 0;
  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const lilchogstars = new Lilchogstars(idx + 1, privateKey, w3);
    const accountMsg = `${lang.account} ${idx + 1}/${privateKeys.length} | ${lilchogstars.walletShort}`;
    safeLog(chalk.blue(`--- ${accountMsg} ---`), addLog);

    try {
      if (await lilchogstars.mint(addLog)) {
        successCount++;
      }
    } catch (e) {
      safeLog(chalk.red(`❌ Account ${idx + 1} failed: ${e.message}`), addLog);
    }

    if (idx < privateKeys.length - 1) {
      const pause = getRandomPause([10, 30]);
      const seconds = (pause / 1000).toFixed(2);
      safeLog(chalk.yellow(lang.waitAccount(seconds)), addLog);
      safeUpdatePanel(chalk.yellow(lang.waitAccount(seconds)), updatePanel);
      await sleep(pause);
    }
  }

  const completionMsg = chalk.green(`--- ${lang.done(privateKeys.length, successCount)} ---`);
  safeLog(completionMsg, addLog);
  safeUpdatePanel(completionMsg, updatePanel);
};
