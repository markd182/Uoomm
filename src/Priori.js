const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;
const axios = require('axios');

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const CONTRACT_ADDRESS = '0xb2f82D0f38dc453D596Ad40A37799446Cc89274A';
const GAS_LIMIT_STAKE = 500000;
const GAS_LIMIT_UNSTAKE = 800000;
const GAS_LIMIT_CLAIM = 800000;
const API_URL = 'https://liquid-staking-backend-prod-b332fbe9ccfe.herokuapp.com/withdrawal_requests';

// Minimal ABI
const MINIMAL_ABI = [
  {
    constant: true,
    inputs: [{ name: '', type: 'address' }],
    name: 'getPendingUnstakeRequests',
    outputs: [{ name: '', type: 'uint256[]' }],
    type: 'function',
  },
];

// Initialize web3 provider
const w3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

function printStep(step, message, lang) {
  const steps = {
    en: {
      stake: 'Stake MON',
      unstake: 'Request Unstake',
      claim: 'Claim MON',
    },
  };
  const stepText = steps[lang][step] || 'UNKNOWN';
  const formattedStep = `${chalk.yellow('➤')} ${chalk.cyan(stepText.padEnd(15))}`;
  return `${formattedStep} | ${message}`;
}

function printHeader(text, color = chalk.cyan) {
  return `${color(`--- ${text} ---`)}`;
}

// Check connection
async function checkConnection(addLog, updatePanel) {
  try {
    await w3.eth.getBlockNumber();
    return true;
  } catch (e) {
    const errorMsg = chalk.red(`❌ Failed to connect to RPC: ${e.message}`);
    addLog(errorMsg);
    updatePanel(errorMsg);
    throw new Error('Failed to connect to RPC');
  }
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
    addLog(errorMsg);
    updatePanel(errorMsg);
    return [];
  }
}

// Generate random amount (0.01–0.05 MON)
function getRandomAmount() {
  const minVal = 0.01;
  const maxVal = 0.05;
  const randomAmount = randomInRange(minVal, maxVal);
  return w3.utils.toWei(randomAmount.toFixed(4), 'ether');
}

// Generate random delay (1–3 minutes)
function getRandomDelay() {
  return randomInRange(1 * 60 * 1000, 3 * 60 * 1000); // Return milliseconds
}

// A Priori class
class APriori {
  constructor(accountIndex, privateKey, language) {
    this.accountIndex = accountIndex;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.language = language;
  }

  async stakeMon(cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const stakeAmount = getRandomAmount();
      const amountEther = Number(w3.utils.fromWei(stakeAmount, 'ether')).toFixed(4);
      const headerMsg = `Cycle ${cycle} | Preparing to stake MON | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));

      addLog(printStep('stake', `Stake Amount: ${chalk.green(`${amountEther} MON`)}`, this.language));

      const functionSelector = '0x6e553f65';
      const data = functionSelector + 
                   w3.utils.padLeft(w3.utils.toHex(stakeAmount).slice(2), 64) +
                   w3.utils.padLeft(this.account.address.slice(2), 64);

      const tx = {
        to: CONTRACT_ADDRESS,
        data: data,
        gas: GAS_LIMIT_STAKE,
        gasPrice: await w3.eth.getGasPrice(),
        value: stakeAmount,
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('stake', 'Sending transaction...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

      addLog(printStep('stake', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      addLog(printStep('stake', 'Waiting for confirmation...', this.language));
      await sleep(1000); // Simulate wait for receipt
      if (txHash.status) {
        addLog(printStep('stake', chalk.green('Stake Successful!'), this.language));
        return stakeAmount;
      } else {
        throw new Error('Stake transaction failed');
      }
    } catch (e) {
      addLog(printStep('stake', chalk.red(`Staking Failed: ${e.message}`), this.language));
      throw e;
    }
  }

  async requestUnstake(amount, cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const amountEther = Number(w3.utils.fromWei(amount, 'ether')).toFixed(4);
      const headerMsg = `Cycle ${cycle} | Requesting unstake | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));

      addLog(printStep('unstake', `Unstake Amount: ${chalk.green(`${amountEther} aprMON`)}`, this.language));

      const functionSelector = '0x7d41c86e';
      const data = functionSelector + 
                   w3.utils.padLeft(w3.utils.toHex(amount).slice(2), 64) +
                   w3.utils.padLeft(this.account.address.slice(2), 64) +
                   w3.utils.padLeft(this.account.address.slice(2), 64);

      const tx = {
        to: CONTRACT_ADDRESS,
        data: data,
        gas: GAS_LIMIT_UNSTAKE,
        gasPrice: await w3.eth.getGasPrice(),
        value: '0',
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('unstake', 'Sending request...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

      addLog(printStep('unstake', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      addLog(printStep('unstake', 'Waiting for confirmation...', this.language));
      await sleep(1000); // Simulate wait for receipt
      if (txHash.status) {
        addLog(printStep('unstake', chalk.green('Unstake Request Successful!'), this.language));
      } else {
        throw new Error('Unstake request failed');
      }
    } catch (e) {
      addLog(printStep('unstake', chalk.red(`Unstake Request Failed: ${e.message}`), this.language));
      throw e;
    }
  }

  async checkClaimableStatus(addLog) {
    try {
      const response = await axios.get(`${API_URL}?address=${this.account.address}`);
      const data = response.data;

      const claimableRequest = data.find(r => !r.claimed && r.is_claimable);
      if (claimableRequest) {
        addLog(printStep('claim', `Found ID: ${chalk.green(claimableRequest.id)}`, this.language));
        return { id: claimableRequest.id, isClaimable: true };
      }

      addLog(printStep('claim', 'No claimable requests', this.language));
      return { id: null, isClaimable: false };
    } catch (e) {
      addLog(printStep('claim', chalk.red(`Check Failed: ${e.message}`), this.language));
      return { id: null, isClaimable: false };
    }
  }

  async claimMon(cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const headerMsg = `Cycle ${cycle} | Checking claim | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));

      const status = await this.checkClaimableStatus(addLog);
      if (!status.isClaimable || !status.id) {
        return null;
      }

      addLog(printStep('claim', `Preparing to claim ID: ${chalk.green(status.id)}`, this.language));

      const functionSelector = '0x492e47d2';
      const data = functionSelector + 
                   w3.utils.padLeft('40', 64) +
                   w3.utils.padLeft(this.account.address.slice(2), 64) +
                   w3.utils.padLeft('1', 64) +
                   w3.utils.padLeft(w3.utils.toHex(status.id).slice(2), 64);

      const tx = {
        to: CONTRACT_ADDRESS,
        data: data,
        gas: GAS_LIMIT_CLAIM,
        gasPrice: await w3.eth.getGasPrice(),
        value: '0',
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('claim', 'Sending transaction...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

      addLog(printStep('claim', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      addLog(printStep('claim', 'Waiting for confirmation...', this.language));
      await sleep(1000); // Simulate wait for receipt
      if (txHash.status) {
        addLog(printStep('claim', chalk.green(`Claim Successful! ID: ${status.id}`), this.language));
        return txHash;
      } else {
        throw new Error('Claim transaction failed');
      }
    } catch (e) {
      addLog(printStep('claim', chalk.red(`Claim Failed: ${e.message}`), this.language));
      throw e;
    }
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput, language) => {
  await checkConnection(addLog, updatePanel);

  addLog(chalk.green('--- STAKING APRIORI - MONAD TESTNET ---'));
  addLog(chalk.cyan(`👥 Accounts: Loading...`));
  updatePanel(chalk.green('--- STAKING APRIORI - MONAD TESTNET ---'));

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys.length) {
    addLog(chalk.red('No private keys loaded, exiting'));
    return;
  }

  addLog(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));
  updatePanel(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));

  let cycleCount;
  while (true) {
    addLog(printHeader('NUMBER OF CYCLES', chalk.yellow));
    const cyclesInput = await requestInput(chalk.green('➤ Enter number: '));
    try {
      cycleCount = cyclesInput.trim() ? parseInt(cyclesInput) : 1;
      if (cycleCount <= 0) throw new Error('Invalid number');
      break;
    } catch (e) {
      addLog(chalk.red('❌ Please enter a positive integer!'));
    }
  }

  const startMsg = `Running ${cycleCount} cycles for ${privateKeys.length} accounts...`;
  addLog(chalk.yellow(`🚀 ${startMsg}`));
  updatePanel(chalk.yellow(`🚀 ${startMsg}`));

  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const walletShort = w3.eth.accounts.privateKeyToAccount(privateKey).address.slice(0, 8) + '...';
    const accountMsg = `ACCOUNT ${idx + 1}/${privateKeys.length} | ${walletShort}`;
    addLog(printHeader(accountMsg, chalk.cyan));
    updatePanel(chalk.cyan(accountMsg));

    const apriori = new APriori(idx + 1, privateKey, language);
    for (let i = 1; i <= cycleCount; i++) {
      try {
        addLog(printHeader(`STARTING CYCLE ${i}`, chalk.cyan));
        const stakeAmount = await apriori.stakeMon(i, addLog);

        let delay = getRandomDelay();
        addLog(chalk.yellow(`⏳ Waiting ${(delay / 1000).toFixed(1)} seconds before unstake...`));
        await sleep(delay);

        await apriori.requestUnstake(stakeAmount, i, addLog);

        addLog(chalk.yellow(`⏳ Waiting 660 seconds (11 minutes) before claim...`));
        await sleep(660000);

        await apriori.claimMon(i, addLog);

        addLog(printHeader(`CYCLE ${i} COMPLETED`, chalk.green));

        if (i < cycleCount) {
          delay = getRandomDelay();
          addLog(chalk.yellow(`⏳ Waiting ${(delay / 1000).toFixed(1)} seconds before next cycle...`));
          await sleep(delay);
        }
      } catch (e) {
        addLog(printHeader(`CYCLE ${i} FAILED: ${e.message}`, chalk.red));
      }
    }

    addLog(chalk.green(`✔ Completed ${walletShort}`));
    if (idx < privateKeys.length - 1) {
      const delay = getRandomDelay();
      addLog(chalk.yellow(`⏳ Waiting ${(delay / 1000).toFixed(1)} seconds before next account...`));
      updatePanel(chalk.yellow(`⏳ Waiting ${(delay / 1000).toFixed(1)} seconds before next account...`));
      await sleep(delay);
    }
  }

  const completionMsg = `
${chalk.green('--- ALL DONE ---')}
${chalk.green(`Completed ${cycleCount} cycles for ${privateKeys.length} accounts`)}
${chalk.green('----------------')}
`;
  addLog(completionMsg);
  updatePanel(completionMsg);
};
