const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const MAGMA_CONTRACT = '0x2c9C959516e9AAEdB2C748224a41249202ca8BE7';
const GAS_LIMIT_STAKE = 500000;
const GAS_LIMIT_UNSTAKE = 800000;

// Initialize web3 provider
const w3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

function printStep(step, message, lang) {
  const steps = {
    en: {
      stake: 'Stake MON',
      unstake: 'Unstake gMON',
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
  return randomInRange(60, 180) * 1000; // Return milliseconds
}

// Magma class
class Magma {
  constructor(accountIndex, privateKey, language) {
    this.accountIndex = accountIndex;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.language = language;
  }

  async stakeMon(amount, cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const amountEther = Number(w3.utils.fromWei(amount, 'ether')).toFixed(4);
      const headerMsg = `Cycle ${cycle} | Staking ${amountEther} MON | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));
      
      const tx = {
        to: MAGMA_CONTRACT,
        data: '0xd5575982',
        from: this.account.address,
        value: amount,
        gas: GAS_LIMIT_STAKE,
        gasPrice: await w3.eth.getGasPrice(),
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('stake', 'Sending transaction...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);
      
      addLog(printStep('stake', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      await sleep(1000); // Simulate wait for receipt
      if (txHash.status) {
        addLog(printStep('stake', chalk.green('Stake successful!'), this.language));
        return amount;
      } else {
        throw new Error('Stake transaction failed');
      }
    } catch (e) {
      addLog(printStep('stake', chalk.red(`Failed: ${e.message}`), this.language));
      throw e;
    }
  }

  async unstakeGmon(amount, cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const amountEther = Number(w3.utils.fromWei(amount, 'ether')).toFixed(4);
      const headerMsg = `Cycle ${cycle} | Unstaking ${amountEther} gMON | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));
      
      const data = '0x6fed1ea7' + w3.utils.padLeft(w3.utils.toHex(amount).slice(2), 64);
      const tx = {
        to: MAGMA_CONTRACT,
        data: data,
        from: this.account.address,
        gas: GAS_LIMIT_UNSTAKE,
        gasPrice: await w3.eth.getGasPrice(),
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('unstake', 'Sending transaction...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);
      
      addLog(printStep('unstake', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      await sleep(1000); // Simulate wait for receipt
      if (txHash.status) {
        addLog(printStep('unstake', chalk.green('Unstake successful!'), this.language));
      } else {
        throw new Error('Unstake transaction failed');
      }
    } catch (e) {
      addLog(printStep('unstake', chalk.red(`Failed: ${e.message}`), this.language));
      throw e;
    }
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput, language) => {
  await checkConnection(addLog, updatePanel);

  addLog(chalk.green('--- MAGMA STAKING - MONAD TESTNET ---'));
  addLog(chalk.cyan(`👥 Accounts: Loading...`));
  updatePanel(chalk.green('--- MAGMA STAKING - MONAD TESTNET ---'));

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys.length) {
    addLog(chalk.red('No private keys loaded, exiting'));
    return;
  }

  addLog(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));
  updatePanel(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));

  let cycles;
  while (true) {
    addLog(printHeader('NUMBER OF CYCLES', chalk.yellow));
    const cyclesInput = await requestInput(chalk.green('➤ Enter number (default 1): '));
    try {
      cycles = cyclesInput.trim() ? parseInt(cyclesInput) : 1;
      if (cycles <= 0) throw new Error('Invalid number');
      break;
    } catch (e) {
      addLog(chalk.red('❌ Please enter a valid number!'));
    }
  }

  const startMsg = `Running ${cycles} staking cycles for ${privateKeys.length} accounts...`;
  addLog(chalk.yellow(`🚀 ${startMsg}`));
  updatePanel(chalk.yellow(`🚀 ${startMsg}`));

  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const walletShort = w3.eth.accounts.privateKeyToAccount(privateKey).address.slice(0, 8) + '...';
    const accountMsg = `ACCOUNT ${idx + 1}/${privateKeys.length} | ${walletShort}`;
    addLog(printHeader(accountMsg, chalk.cyan));
    updatePanel(chalk.cyan(accountMsg));

    const magma = new Magma(idx + 1, privateKey, language);
    for (let i = 0; i < cycles; i++) {
      try {
        const amount = getRandomAmount();
        const stakeAmount = await magma.stakeMon(amount, i + 1, addLog);
        let delay = getRandomDelay();
        addLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before unstaking...`));
        await sleep(delay);
        await magma.unstakeGmon(stakeAmount, i + 1, addLog);

        if (i < cycles - 1) {
          delay = getRandomDelay();
          addLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next cycle...`));
          await sleep(delay);
        }
      } catch (e) {
        addLog(chalk.red(`[${idx + 1}] Cycle ${i + 1} failed: ${e.message}`));
      }
    }

    if (idx < privateKeys.length - 1) {
      const delay = getRandomDelay();
      addLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next account...`));
      updatePanel(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next account...`));
      await sleep(delay);
    }
  }

  const completionMsg = `
${chalk.green('--- ALL DONE ---')}
${chalk.green(`Completed ${cycles} cycles for ${privateKeys.length} accounts`)}
${chalk.green('----------------')}
`;
  addLog(completionMsg);
  updatePanel(completionMsg);
};
