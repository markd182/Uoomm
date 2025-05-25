const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const KITSU_STAKING_CONTRACT = '0x07AabD925866E8353407E67C1D157836f7Ad923e';
const GAS_LIMIT = 500000;

// Staking ABI
const STAKING_ABI = [
  { name: 'stake', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] },
  { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] },
  { name: 'withdrawWithSelector', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }], selector: '0x30af6b2e' },
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
      unstake: 'Unstake sMON',
    },
  };
  const stepText = steps[lang][step] || 'UNKNOWN';
  const formattedStep = `${chalk.yellow('🔸')} ${chalk.cyan(stepText.padEnd(15))}`;
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

// Kitsu class
class Kitsu {
  constructor(accountIndex, privateKey, language) {
    this.accountIndex = accountIndex;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.language = language;
    this.contract = new w3.eth.Contract(STAKING_ABI, KITSU_STAKING_CONTRACT);
  }

  async stakeMon(amount, cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const amountEther = Number(w3.utils.fromWei(amount, 'ether')).toFixed(4);
      const headerMsg = `Cycle ${cycle} | Staking ${amountEther} MON | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));

      const balance = await w3.eth.getBalance(this.account.address);
      const balanceEther = Number(w3.utils.fromWei(balance, 'ether')).toFixed(4);
      addLog(printStep('stake', `Balance: ${chalk.cyan(`${balanceEther} MON`)}`, this.language));
      if (BigInt(balance) < BigInt(amount)) {
        throw new Error(`Insufficient balance: ${balanceEther} MON < ${amountEther} MON`);
      }

      const tx = {
        to: KITSU_STAKING_CONTRACT,
        data: this.contract.methods.stake().encodeABI(),
        from: this.account.address,
        value: amount,
        gas: GAS_LIMIT,
        gasPrice: await w3.eth.getGasPrice(),
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('stake', 'Sending stake transaction...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

      addLog(printStep('stake', `Tx Hash: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      await sleep(2000); // Wait 2 seconds
      if (txHash.status) {
        addLog(printStep('stake', chalk.green('✔ Stake successful!'), this.language));
        return amount;
      } else {
        throw new Error(`Transaction failed: Status ${txHash.status}`);
      }
    } catch (e) {
      let errorMsg = `Failed: ${e.message}`;
      if (e.message.includes('revert')) {
        errorMsg = `Failed: Contract reverted - ${e.message}`;
      }
      addLog(printStep('stake', chalk.red(`✘ ${errorMsg}`), this.language));
      throw e;
    }
  }

  async unstakeMon(amount, cycle, addLog) {
    try {
      const walletShort = this.account.address.slice(0, 8) + '...';
      const amountEther = Number(w3.utils.fromWei(amount, 'ether')).toFixed(4);
      const headerMsg = `Cycle ${cycle} | Unstaking ${amountEther} sMON | ${walletShort}`;
      addLog(printHeader(headerMsg, chalk.blue));

      const data = '0x30af6b2e' + w3.utils.padLeft(w3.utils.toHex(amount).slice(2), 64);
      const tx = {
        to: KITSU_STAKING_CONTRACT,
        data: data,
        from: this.account.address,
        gas: GAS_LIMIT,
        gasPrice: await w3.eth.getGasPrice(),
        nonce: await w3.eth.getTransactionCount(this.account.address),
        chainId: 10143,
      };

      addLog(printStep('unstake', 'Sending unstake transaction...', this.language));
      const signedTx = await w3.eth.accounts.signTransaction(tx, this.account.privateKey);
      const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

      addLog(printStep('unstake', `Tx Hash: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, this.language));
      await sleep(2000); // Wait 2 seconds
      if (txHash.status) {
        addLog(printStep('unstake', chalk.green('✔ Unstake successful!'), this.language));
      } else {
        throw new Error(`Transaction failed: Status ${txHash.status}`);
      }
    } catch (e) {
      let errorMsg = `Failed: ${e.message}`;
      if (e.message.includes('revert')) {
        errorMsg = `Failed: Contract reverted - ${e.message}`;
      }
      addLog(printStep('unstake', chalk.red(`✘ ${errorMsg}`), this.language));
      throw e;
    }
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput, language) => {
  await checkConnection(addLog, updatePanel);

  addLog(chalk.green('--- KITSU STAKING - MONAD TESTNET ---'));
  addLog(chalk.cyan(`👥 Accounts: Loading...`));
  updatePanel(chalk.green('--- KITSU STAKING - MONAD TESTNET ---'));

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

  const startMsg = `Running ${cycles} Kitsu staking cycles for ${privateKeys.length} accounts...`;
  addLog(chalk.yellow(`🚀 ${startMsg}`));
  updatePanel(chalk.yellow(`🚀 ${startMsg}`));

  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const walletShort = w3.eth.accounts.privateKeyToAccount(privateKey).address.slice(0, 8) + '...';
    const accountMsg = `ACCOUNT ${idx + 1}/${privateKeys.length} | ${walletShort}`;
    addLog(printHeader(accountMsg, chalk.blue));
    updatePanel(chalk.blue(accountMsg));

    const kitsu = new Kitsu(idx + 1, privateKey, language);
    for (let i = 0; i < cycles; i++) {
      try {
        const amount = getRandomAmount();
        const stakeAmount = await kitsu.stakeMon(amount, i + 1, addLog);
        let delay = getRandomDelay();
        addLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before unstaking...`));
        await sleep(delay);
        await kitsu.unstakeMon(stakeAmount, i + 1, addLog);

        if (i < cycles - 1) {
          delay = getRandomDelay();
          addLog(chalk.yellow(`⏳ Waiting ${(delay / 60000).toFixed(1)} minutes before next cycle...`));
          await sleep(delay);
        }
      } catch (e) {
        addLog(chalk.red(`Error in cycle ${i + 1}: ${e.message}`));
        continue;
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
