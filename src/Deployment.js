const Web3 = require('web3');
const solc = require('solc');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/0x';

// Source code of the contract
const CONTRACT_SOURCE = `
pragma solidity ^0.8.0;

contract Counter {
    uint256 private count;
    
    event CountIncremented(uint256 newCount);
    
    function increment() public {
        count += 1;
        emit CountIncremented(count);
    }
    
    function getCount() public view returns (uint256) {
        return count;
    }
}
`;

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

function printStep(step, message, lang) {
  const steps = {
    en: {
      compile: 'COMPILING',
      deploy: 'DEPLOYING',
    },
  };
  const stepText = steps[lang][step] || 'UNKNOWN';
  const formattedStep = `${chalk.yellow('🔸')} ${chalk.cyan(stepText.padEnd(15))}`;
  return `${formattedStep} | ${message}`;
}

function printHeader(text, color = chalk.magenta) {
  return `${color(`--- ${text} ---`)}`;
}

// Initialize web3 provider
const w3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));

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
    return null;
  }
}

// Compile contract
function compileContract(addLog, language) {
  const lang = {
    en: {
      start: 'Compiling contract...',
      success: 'Contract compiled successfully!',
    },
  }[language];

  addLog(printStep('compile', lang.start, language));
  try {
    const input = {
      language: 'Solidity',
      sources: {
        'Counter.sol': {
          content: CONTRACT_SOURCE,
        },
      },
      settings: {
        outputSelection: {
          '*': {
            '*': ['abi', 'evm'],
          },
        },
      },
    };

    const output = JSON.parse(solc.compile(JSON.stringify(input)));
    if (output.errors && output.errors.length > 0) {
      const errorMsg = output.errors
        .filter((e) => e.severity === 'error')
        .map((e) => e.formattedMessage)
        .join('\n');
      if (errorMsg) {
        throw new Error(`Compilation errors: ${errorMsg}`);
      }
    }

    const contract = output.contracts['Counter.sol']['Counter'];
    addLog(printStep('compile', chalk.green(`✔ ${lang.success}`), language));
    return {
      abi: contract.abi,
      bytecode: contract.evm.bytecode.object,
    };
  } catch (e) {
    const errorMsg = chalk.red(`✘ Compilation failed: ${e.message}`);
    addLog(printStep('compile', errorMsg, language));
    throw e;
  }
}

// Deploy contract
async function deployContract(privateKey, tokenName, tokenSymbol, language, addLog) {
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const wallet = account.address.slice(0, 8) + '...';
    const lang = {
      en: {
        start: `Deploying contract ${tokenName} (${tokenSymbol})`,
        send: 'Sending transaction...',
        success: `Contract ${tokenName} deployed successfully!`,
      },
    }[language];

    addLog(printHeader(`${lang.start} | ${wallet}`, chalk.magenta));

    const compiled = compileContract(addLog, language);
    const abi = compiled.abi;
    const bytecode = compiled.bytecode;

    const nonce = await w3.eth.getTransactionCount(account.address);
    addLog(printStep('deploy', `Nonce: ${chalk.cyan(nonce)}`, language));

    const contract = new w3.eth.Contract(abi);
    const tx = contract.deploy({
      data: bytecode,
    }).encodeABI();

    const gasEstimate = await w3.eth.estimateGas({
      from: account.address,
      data: tx,
    });

    const transaction = {
      from: account.address,
      data: tx,
      gas: Math.floor(gasEstimate * 1.2).toString(),
      gasPrice: (await w3.eth.getGasPrice()).toString(),
      nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    addLog(printStep('deploy', lang.send, language));
    const signedTx = await w3.eth.accounts.signTransaction(transaction, privateKey);
    const txResult = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);
    const txHash = txResult.transactionHash;

    addLog(printStep('deploy', `Tx Hash: ${chalk.yellow(`${EXPLORER_URL}${txHash}`)}`, language));
    await sleep(2000); // Wait 2 seconds

    const receipt = await w3.eth.getTransactionReceipt(txHash);
    if (receipt.status) {
      addLog(printStep('deploy', chalk.green(`✔ ${lang.success}`), language));
      addLog(chalk.cyan(`📌 Contract Address: ${chalk.yellow(receipt.contractAddress)}`));
      return receipt.contractAddress;
    } else {
      throw new Error(`Transaction failed: Status ${receipt.status}`);
    }
  } catch (e) {
    const errorMsg = chalk.red(`✘ Deployment failed: ${e.message}`);
    addLog(printStep('deploy', errorMsg, language));
    return null;
  }
}

// Run deploy cycle for each private key
async function runDeployCycle(cycles, privateKeys, language, addLog, updatePanel, requestInput) {
  const lang = {
    en: 'CONTRACT DEPLOY CYCLE',
  }[language];

  for (let accountIdx = 0; accountIdx < privateKeys.length; accountIdx++) {
    const privateKey = privateKeys[accountIdx];
    const wallet = w3.eth.accounts
      .privateKeyToAccount(privateKey)
      .address.slice(0, 8) + '...';
    addLog(printHeader(`ACCOUNT ${accountIdx + 1}/${privateKeys.length} | ${wallet}`, chalk.blue));
    updatePanel(chalk.blue(`ACCOUNT ${accountIdx + 1}/${privateKeys.length} | ${wallet}`));

    for (let i = 0; i < cycles; i++) {
      addLog(printHeader(`${lang} ${i + 1}/${cycles} | ${wallet}`, chalk.cyan));

      let tokenName = await requestInput(chalk.green('➤ Enter the token name (e.g., Thog Token): '));
      let tokenSymbol = await requestInput(chalk.green('➤ Enter the token symbol (e.g., THOG): '));

      // Log input for debugging
      addLog(chalk.gray(`[DEBUG] Received tokenName: "${tokenName}", tokenSymbol: "${tokenSymbol}"`));

      // Trim and use defaults if empty
      tokenName = tokenName?.trim() || `Counter Token ${i + 1}`;
      tokenSymbol = tokenSymbol?.trim() || `CTR${i + 1}`;

      // Re-validate to ensure non-empty
      if (!tokenName || !tokenSymbol) {
        addLog(chalk.red(`❌ Invalid token name or symbol after defaults: "${tokenName}", "${tokenSymbol}"`));
        continue;
      }

      addLog(chalk.gray(`[DEBUG] Using tokenName: "${tokenName}", tokenSymbol: "${tokenSymbol}"`));
      await deployContract(privateKey, tokenName, tokenSymbol, language, addLog);

      if (i < cycles - 1) {
        const delay = randomInRange(4, 6);
        addLog(chalk.yellow(`⏳ Waiting ${delay.toFixed(2)} seconds before next cycle...`));
        await sleep(delay * 1000);
      }
    }

    if (accountIdx < privateKeys.length - 1) {
      const delay = randomInRange(4, 6);
      addLog(chalk.yellow(`⏳ Waiting ${delay.toFixed(2)} seconds before next account...`));
      updatePanel(chalk.yellow(`⏳ Waiting ${delay.toFixed(2)} seconds before next account...`));
      await sleep(delay * 1000);
    }
  }

  const completionMsg = `
${chalk.green('--- ALL DONE ---')}
${chalk.green(`Completed ${cycles} cycles for ${privateKeys.length} accounts`)}
${chalk.green('----------------')}
`;
  addLog(completionMsg);
  updatePanel(completionMsg);
}

// Main function
module.exports = async (addLog, updatePanel, closeUI, requestInput, language) => {
  await checkConnection(addLog, updatePanel);

  addLog(chalk.green('--- DEPLOY CONTRACT - MONAD TESTNET ---'));
  addLog(chalk.cyan(`👥 Accounts: Loading...`));
  updatePanel(chalk.green('--- DEPLOY CONTRACT - MONAD TESTNET ---'));

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys) {
    return;
  }

  addLog(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));
  updatePanel(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));

  let cycles;
  while (true) {
    try {
      const cyclesInput = await requestInput(chalk.green('➤ Enter number of cycles (default 1): '));
      cycles = cyclesInput.trim() ? parseInt(cyclesInput, 10) : 1;
      if (cycles <= 0) {
        throw new Error('Invalid number');
      }
      break;
    } catch (e) {
      addLog(chalk.red('❌ Please enter a valid number!'));
    }
  }

  const startMsg = `Running ${cycles} contract deploy cycles for ${privateKeys.length} accounts...`;
  addLog(chalk.yellow(`🚀 ${startMsg}`));
  updatePanel(chalk.yellow(`🚀 ${startMsg}`));

  await runDeployCycle(cycles, privateKeys, language, addLog, updatePanel, requestInput);
};
