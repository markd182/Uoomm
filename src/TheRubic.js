const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const WMON_CONTRACT = '0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701';
const ROUTER_ADDRESS = '0xF6FFe4f3FdC8BBb7F70FFD48e61f17D1e343dDfD';
const USDT_ADDRESS = '0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D';
const POOL_FEE = 10000; // 1% fee
const CHAIN_ID = 10143; // Monad testnet chain ID

// Token definitions
const RUBIC_TOKENS = {
  wmon: { address: WMON_CONTRACT, decimals: 18 },
  usdt: { address: USDT_ADDRESS, decimals: 6 },
  usdc: { address: '0xf817257fed379853cDe0fa4F97AB987181B1E5Ea', decimals: 6 },
  dak: { address: '0x0F0BDEbF0F83cD1EE3974779Bcb7315f9808c714', decimals: 18 },
  yaki: { address: '0xfe140e1dCe99Be9F4F15d657CD9b7BF622270C50', decimals: 18 },
  chodg: { address: '0xE0590015A873bF326bd645c3E1266d4db41C4E6B', decimals: 18 },
};

// Contract ABIs
const WMON_ABI = [
  { constant: false, inputs: [], name: 'deposit', outputs: [], payable: true, stateMutability: 'payable', type: 'function' },
  { constant: false, inputs: [{ name: 'amount', type: 'uint256' }], name: 'withdraw', outputs: [], payable: false, stateMutability: 'nonpayable', type: 'function' },
  { constant: false, inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], payable: false, stateMutability: 'nonpayable', type: 'function' },
  { constant: true, inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], payable: false, stateMutability: 'view', type: 'function' },
];

const ERC20_ABI = [
  { constant: true, inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ name: '', type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { constant: false, inputs: [{ name: 'spender', type: 'address' }, { name: 'value', type: 'uint256' }], name: 'approve', outputs: [{ name: '', type: 'bool' }], stateMutability: 'nonpayable', type: 'function' },
];

const RUBIC_ABI = [
  { inputs: [{ internalType: 'bytes[]', name: 'data', type: 'bytes[]' }], name: 'multicall', outputs: [{ internalType: 'bytes[]', name: 'results', type: 'bytes[]' }], stateMutability: 'payable', type: 'function' },
  { inputs: [], name: 'refundETH', outputs: [], stateMutability: 'payable', type: 'function' },
  { inputs: [{ components: [{ internalType: 'bytes', name: 'path', type: 'bytes' }, { internalType: 'address', name: 'recipient', type: 'address' }, { internalType: 'uint128', name: 'amount', type: 'uint128' }, { internalType: 'uint256', name: 'minAcquired', type: 'uint256' }, { internalType: 'uint256', name: 'deadline', type: 'uint256' }], internalType: 'struct IiZiSwapRouter.SwapAmountParams', name: 'params', type: 'tuple' }], name: 'swapAmount', outputs: [{ internalType: 'uint256', name: 'cost', type: 'uint256' }, { internalType: 'uint256', name: 'acquire', type: 'uint256' }], stateMutability: 'payable', type: 'function' },
  { inputs: [{ internalType: 'uint256', name: 'minAmount', type: 'uint256' }, { internalType: 'address', name: 'recipient', type: 'address' }], name: 'unwrapWETH9', outputs: [], stateMutability: 'payable', type: 'function' },
];

// Initialize web3 provider and contracts
const w3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));
const wmonContract = new w3.eth.Contract(WMON_ABI, WMON_CONTRACT);
const routerContract = new w3.eth.Contract(RUBIC_ABI, ROUTER_ADDRESS);

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

function printStep(step, message, lang) {
  const steps = {
    en: {
      wrap: 'WRAP MON',
      unwrap: 'UNWRAP WMON',
      swap: 'SWAP TOKENS',
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

// Get MON amount from user
async function getMonAmountFromUser(language, requestInput, addLog) {
  const lang = {
    en: {
      prompt: 'Enter MON amount (0.01 - 999): ',
      error: 'Amount must be 0.01-999 / Enter a valid number!',
    },
  }[language];

  while (true) {
    try {
      addLog(printHeader(lang.prompt, chalk.yellow));
      const amountInput = await requestInput(chalk.green('➤ '));
      const amount = parseFloat(amountInput.trim());
      if (amount >= 0.01 && amount <= 999) {
        return BigInt(w3.utils.toWei(amount.toString(), 'ether'));
      }
      addLog(chalk.red(`❌ ${lang.error}`));
    } catch (e) {
      addLog(chalk.red(`❌ ${lang.error}`));
    }
  }
}

// Get random delay
function getRandomDelay(minDelay = 60, maxDelay = 180) {
  return Math.floor(randomInRange(minDelay, maxDelay));
}

// Get balance
async function getBalance(account, token) {
  if (token === 'mon') {
    return BigInt(await w3.eth.getBalance(account));
  }
  const tokenContract = new w3.eth.Contract(ERC20_ABI, RUBIC_TOKENS[token].address);
  return BigInt(await tokenContract.methods.balanceOf(account).call());
}

// Get available tokens
async function getAvailableTokens(account, minAmount = BigInt(10 ** 14)) {
  const available = [];
  const monBalance = await getBalance(account, 'mon');
  if (monBalance >= minAmount) {
    available.push(['mon', monBalance]);
  }
  for (const token in RUBIC_TOKENS) {
    const balance = await getBalance(account, token);
    if (balance >= minAmount) {
      available.push([token, balance]);
    }
  }
  return available;
}

// Wrap MON
async function wrapMon(privateKey, amount, language, addLog) {
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const wallet = account.address.slice(0, 8) + '...';
    const lang = {
      en: {
        start: `Wrap ${w3.utils.fromWei(amount.toString(), 'ether')} MON → WMON | ${wallet}`,
        send: 'Sending transaction...',
        success: 'Wrap successful!',
      },
    }[language];

    if ((await getBalance(account.address, 'mon')) < amount) {
      addLog(printStep('wrap', chalk.red('Insufficient MON balance'), language));
      return false;
    }

    addLog(printHeader(lang.start, chalk.cyan));
    const tx = {
      from: account.address,
      to: WMON_CONTRACT,
      value: amount.toString(),
      gas: '500000',
      gasPrice: w3.utils.toWei('100', 'gwei'),
      nonce: await w3.eth.getTransactionCount(account.address),
      chainId: CHAIN_ID,
      data: wmonContract.methods.deposit().encodeABI(),
    };

    addLog(printStep('wrap', lang.send, language));
    const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
    const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

    addLog(printStep('wrap', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txHash.transactionHash}`)}`, language));
    addLog(printStep('wrap', chalk.green(lang.success), language));
    return true;
  } catch (e) {
    addLog(printStep('wrap', chalk.red(`Failed: ${e.message}`), language));
    return false;
  }
}

// Swap tokens
async function swapTokens(privateKey, tokenIn, tokenOut, amount, language, addLog) {
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const wallet = account.address.slice(0, 8) + '...';
    const tokenInDisplay = tokenIn === 'mon' ? 'MON' : tokenIn.toUpperCase();
    const tokenOutDisplay = tokenOut === 'mon' ? 'MON' : tokenOut.toUpperCase();
    const amountReadable = tokenIn === 'mon' ? w3.utils.fromWei(amount.toString(), 'ether') : (Number(amount) / 10 ** RUBIC_TOKENS[tokenIn].decimals).toString();
    const lang = {
      en: {
        start: `Swap ${amountReadable} ${tokenInDisplay} → ${tokenOutDisplay} | ${wallet}`,
        send: 'Sending swap transaction...',
        success: 'Swap successful!',
      },
    }[language];

    addLog(printHeader(lang.start, chalk.cyan));

    // Check balance
    const balance = await getBalance(account.address, tokenIn);
    if (balance < amount) {
      addLog(printStep('swap', chalk.red(`Insufficient ${tokenInDisplay} balance: ${(Number(balance) / 10 ** (tokenIn === 'mon' ? 18 : RUBIC_TOKENS[tokenIn].decimals)).toString()} available`), language));
      return false;
    }

    // Approve token if not MON
    if (tokenIn !== 'mon') {
      const tokenContract = new w3.eth.Contract(ERC20_ABI, RUBIC_TOKENS[tokenIn].address);
      const approveTx = {
        from: account.address,
        to: RUBIC_TOKENS[tokenIn].address,
        gas: '100000',
        gasPrice: w3.utils.toWei('50', 'gwei'),
        nonce: await w3.eth.getTransactionCount(account.address),
        chainId: CHAIN_ID,
        data: tokenContract.methods.approve(ROUTER_ADDRESS, amount.toString()).encodeABI(),
      };
      const signedApprove = await w3.eth.accounts.signTransaction(approveTx, privateKey);
      const approveHash = await w3.eth.sendSignedTransaction(signedApprove.rawTransaction);
      addLog(printStep('swap', `Approval Tx: ${chalk.yellow(`${EXPLORER_URL}${approveHash.transactionHash}`)}`, language));
    }

    // Prepare swap path
    const tokenInAddr = tokenIn === 'mon' ? WMON_CONTRACT : RUBIC_TOKENS[tokenIn].address;
    const tokenOutAddr = tokenOut === 'mon' ? WMON_CONTRACT : RUBIC_TOKENS[tokenOut].address;
    const path = '0x' + w3.utils.toChecksumAddress(tokenInAddr).slice(2) + w3.utils.padLeft(w3.utils.numberToHex(POOL_FEE), 6).slice(2) + w3.utils.toChecksumAddress(tokenOutAddr).slice(2);
    const deadline = Math.floor(Date.now() / 1000) + 3600;

    // Encode swap data
    const recipient = tokenOut === 'mon' ? ROUTER_ADDRESS : account.address;
    const swapParams = [
      path,
      recipient,
      amount.toString(),
      '0',
      deadline.toString(),
    ];
    const swapData = routerContract.methods.swapAmount(swapParams).encodeABI();
    const multicallData = [swapData];

    if (tokenOut === 'mon') {
      const unwrapData = routerContract.methods.unwrapWETH9('0', account.address).encodeABI();
      const refundData = routerContract.methods.refundETH().encodeABI();
      multicallData.push(unwrapData, refundData);
    }

    const finalData = routerContract.methods.multicall(multicallData).encodeABI();

    // Build transaction
    const tx = {
      from: account.address,
      to: ROUTER_ADDRESS,
      value: tokenIn === 'mon' ? amount.toString() : '0',
      data: finalData,
      gas: '500000',
      gasPrice: w3.utils.toWei('100', 'gwei'),
      nonce: await w3.eth.getTransactionCount(account.address),
      chainId: CHAIN_ID,
    };

    addLog(printStep('swap', lang.send, language));
    const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
    const txResult = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

    addLog(printStep('swap', `Tx: ${chalk.yellow(`${EXPLORER_URL}${txResult.transactionHash}`)}`, language));
    const receipt = await w3.eth.getTransactionReceipt(txResult.transactionHash);

    if (receipt.status) {
      addLog(printStep('swap', chalk.green(lang.success), language));
      return true;
    } else {
      addLog(printStep('swap', chalk.red('Swap failed'), language));
      return false;
    }
  } catch (e) {
    addLog(printStep('swap', chalk.red(`Failed: ${e.message}`), language));
    return false;
  }
}

// Run swap cycle
async function runSwapCycle(cycles, privateKeys, language, addLog, updatePanel, requestInput) {
  const allTokens = Object.keys(RUBIC_TOKENS);
  for (let cycle = 1; cycle <= cycles; cycle++) {
    for (const pk of privateKeys) {
      const account = w3.eth.accounts.privateKeyToAccount(pk);
      const wallet = account.address.slice(0, 8) + '...';
      const msg = `CYCLE ${cycle}/${cycles} | Account: ${wallet}`;
      addLog(printHeader(msg, chalk.blue));
      updatePanel(chalk.blue(msg));

      // Get available tokens
      const availableTokens = await getAvailableTokens(account.address);
      if (!availableTokens.length) {
        addLog(chalk.yellow('No tokens with sufficient balance available'));
        continue;
      }

      // Wrap some MON if MON is available
      const amount = await getMonAmountFromUser(language, requestInput, addLog);
      const hasMon = availableTokens.some(([t]) => t === 'mon');
      if (hasMon) {
        if (await wrapMon(pk, amount, language, addLog)) {
          // Swap MON to all other tokens
          const monBalance = await getBalance(account.address, 'mon');
          if (monBalance >= amount) {
            const swapAmount = amount / BigInt(allTokens.length - 1); // Exclude WMON
            for (const tokenOut of allTokens) {
              if (tokenOut !== 'wmon') {
                if (await swapTokens(pk, 'mon', tokenOut, swapAmount, language, addLog)) {
                  await sleep(5000); // 5-second delay
                  // Swap back to MON
                  const tokenBalance = await getBalance(account.address, tokenOut);
                  if (tokenBalance >= BigInt(10 ** 14)) {
                    await swapTokens(pk, tokenOut, 'mon', tokenBalance / BigInt(2), language, addLog);
                  }
                } else {
                  addLog(chalk.yellow(`Skipping swap to ${tokenOut.toUpperCase()} due to failure`));
                }
              }
            }
          } else {
            addLog(chalk.yellow('Insufficient MON balance after wrap'));
          }
        } else {
          addLog(chalk.yellow('Wrap failed, skipping swaps'));
        }
      } else {
        addLog(chalk.yellow('No MON available to wrap and swap'));
      }

      if (cycle < cycles || pk !== privateKeys[privateKeys.length - 1]) {
        const delay = getRandomDelay();
        addLog(chalk.yellow(`⏳ Waiting ${delay} seconds...`));
        updatePanel(chalk.yellow(`⏳ Waiting ${delay} seconds...`));
        await sleep(delay * 1000);
      }
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

  addLog(chalk.green('--- RUBIC SWAP - MONAD TESTNET ---'));
  addLog(chalk.cyan(`👥 Accounts: Loading...`));
  updatePanel(chalk.green('--- RUBIC SWAP - MONAD TESTNET ---'));

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys.length) {
    addLog(chalk.red('No private keys loaded, exiting'));
    return;
  }

  addLog(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));
  updatePanel(chalk.cyan(`👥 Accounts: ${privateKeys.length}`));

  let cycles;
  while (true) {
    try {
      addLog(printHeader('NUMBER OF CYCLES', chalk.yellow));
      const cyclesInput = await requestInput(chalk.green('➤ Enter number of cycles (default 1): '));
      cycles = cyclesInput.trim() ? parseInt(cyclesInput, 10) : 1;
      if (cycles > 0) {
        break;
      }
      addLog(chalk.red('❌ Number must be > 0'));
    } catch (e) {
      addLog(chalk.red('❌ Enter a valid number'));
    }
  }

  const startMsg = `Running ${cycles} swap cycles...`;
  addLog(chalk.yellow(`🚀 ${startMsg}`));
  updatePanel(chalk.yellow(`🚀 ${startMsg}`));

  await runSwapCycle(cycles, privateKeys, language, addLog, updatePanel, requestInput);
};
