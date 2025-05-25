const Web3 = require('web3');
const fs = require('fs');
const chalk = require('chalk');

// Constants
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/0x";
const ROUTER_CONTRACT = "0x64Aff7245EbdAAECAf266852139c67E4D8DBa4de";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const USDC_CONTRACT = "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";
const USDT_CONTRACT = "0x88b8E2161DEDC77EF4ab7585569D2415a1C1055D";
const WETH_CONTRACT = "0xB5a30b0FDc5EA94A52fDc42e3E9760Cb8449Fb37";
const WSOL_CONTRACT = "0x5387C85A4965769f6B0Df430638a1388493486F1";
const WBTC_CONTRACT = "0xcf5a6076cfa32686c0Df13aBaDa2b40dec133F1d";
const MAD_CONTRACT = "0xC8527e96c3CB9522f6E35e95C0A28feAb8144f15";
const CHAIN_ID = 10143;

// ABI for contracts
const ABI = {
    router: [
        {
            type: "function",
            name: "swapExactETHForTokens",
            inputs: [
                { internalType: "uint256", name: "amountOutMin", type: "uint256" },
                { internalType: "address[]", name: "path", type: "address[]" },
                { internalType: "address", name: "to", type: "address" },
                { internalType: "uint256", name: "deadline", type: "uint256" },
            ],
            outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
            stateMutability: "payable",
        },
        {
            type: "function",
            name: "swapExactTokensForETH",
            inputs: [
                { internalType: "uint256", name: "amountIn", type: "uint256" },
                { internalType: "uint256", name: "amountOutMin", type: "uint256" },
                { internalType: "address[]", name: "path", type: "address[]" },
                { internalType: "address", name: "to", type: "address" },
                { internalType: "uint256", name: "deadline", type: "uint256" },
            ],
            outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
            stateMutability: "nonpayable",
        },
        {
            type: "function",
            name: "swapExactTokensForTokens",
            inputs: [
                { internalType: "uint256", name: "amountIn", type: "uint256" },
                { internalType: "uint256", name: "amountOutMin", type: "uint256" },
                { internalType: "address[]", name: "path", type: "address[]" },
                { internalType: "address", name: "to", type: "address" },
                { internalType: "uint256", name: "deadline", type: "uint256" },
            ],
            outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
            stateMutability: "nonpayable",
        },
        {
            type: "function",
            name: "getAmountsOut",
            inputs: [
                { internalType: "uint256", name: "amountIn", type: "uint256" },
                { internalType: "address[]", name: "path", type: "address[]" },
            ],
            outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
            stateMutability: "view",
        },
    ],
    token: [
        {
            type: "function",
            name: "approve",
            inputs: [
                { name: "guy", type: "address" },
                { name: "wad", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
        },
        {
            type: "function",
            name: "balanceOf",
            inputs: [{ name: "", type: "address" }],
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
        },
        {
            type: "function",
            name: "decimals",
            inputs: [],
            outputs: [{ name: "", type: "uint8" }],
            stateMutability: "view",
        },
        {
            type: "function",
            name: "allowance",
            inputs: [
                { name: "", type: "address" },
                { name: "", type: "address" },
            ],
            outputs: [{ name: "", type: "uint256" }],
            stateMutability: "view",
        },
    ],
};

// Fallback ABI for critical methods
const FALLBACK_ABI = {
    router: [
        {
            type: "function",
            name: "swapExactTokensForTokens",
            inputs: [
                { internalType: "uint256", name: "amountIn", type: "uint256" },
                { internalType: "uint256", name: "amountOutMin", type: "uint256" },
                { internalType: "address[]", name: "path", type: "address[]" },
                { internalType: "address", name: "to", type: "address" },
                { internalType: "uint256", name: "deadline", type: "uint256" },
            ],
            outputs: [{ internalType: "uint256[]", name: "amounts", type: "uint256[]" }],
            stateMutability: "nonpayable",
        },
    ],
    token: [
        {
            type: "function",
            name: "approve",
            inputs: [
                { name: "guy", type: "address" },
                { name: "wad", type: "uint256" },
            ],
            outputs: [{ name: "", type: "bool" }],
            stateMutability: "nonpayable",
        },
    ],
};

// Available tokens
const AVAILABLE_TOKENS = {
    MON: { name: "MON", address: null, decimals: 18, native: true },
    WMON: { name: "WMON", address: WMON_CONTRACT, decimals: 18, native: false },
    USDC: { name: "USDC", address: USDC_CONTRACT, decimals: 6, native: false },
    USDT: { name: "USDT", address: USDT_CONTRACT, decimals: 6, native: false },
    WETH: { name: "WETH", address: WETH_CONTRACT, decimals: 18, native: false },
    WSOL: { name: "WSOL", address: WSOL_CONTRACT, decimals: 18, native: false },
    WBTC: { name: "WBTC", address: WBTC_CONTRACT, decimals: 8, native: false },
    MAD: { name: "MAD", address: MAD_CONTRACT, decimals: 18, native: false },
};

const TOKEN_LIST = ["MON", "WMON", "USDC", "USDT", "WETH", "WSOL", "WBTC", "MAD"];

// Initialize Web3
const web3 = new Web3(RPC_URL);

// Initialize contracts
let routerContract = new web3.eth.Contract(ABI.router, ROUTER_CONTRACT);

// Utility functions
function loadPrivateKeys(addLog, filePath = 'pvkey.txt') {
    try {
        addLog(chalk.cyan('Loading private keys...'));
        const keys = fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line && !line.startsWith('#'));
        const validKeys = [];
        keys.forEach((key, index) => {
            const cleanKey = key.startsWith('0x') ? key : '0x' + key;
            if (/^0x[0-9a-fA-F]{64}$/.test(cleanKey)) {
                validKeys.push({ line: index + 1, key: cleanKey });
            } else {
                addLog(chalk.yellow(`Warning: Line ${index + 1} is invalid, skipped: ${key}`));
            }
        });
        if (!validKeys.length) {
            addLog(chalk.red(`No valid private keys found in ${filePath}`));
            return [];
        }
        addLog(chalk.cyan(`Found ${validKeys.length} valid private keys`));
        return validKeys;
    } catch (error) {
        if (error.code === 'ENOENT') {
            addLog(chalk.red(`File ${filePath} not found`));
            fs.writeFileSync(filePath, "# Add private keys here, one per line\n# Example: 0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef\n");
        } else {
            addLog(chalk.red(`Error reading ${filePath}: ${error.message}`));
        }
        return [];
    }
}

async function checkTokenBalance(addLog, address, token) {
    try {
        address = web3.utils.toChecksumAddress(address);
        if (token.native) {
            const balanceWei = await web3.eth.getBalance(address);
            return Number(web3.utils.fromWei(balanceWei, 'ether'));
        } else {
            const tokenContract = new web3.eth.Contract(ABI.token, token.address);
            const balance = await tokenContract.methods.balanceOf(address).call();
            return balance / (10 ** token.decimals);
        }
    } catch (error) {
        addLog(chalk.red(`Error fetching balance for ${token.name}: ${error.message}`));
        return -1;
    }
}

async function displayTokenBalances(addLog, address) {
    addLog(chalk.cyan('Balance'));
    for (const [symbol, token] of Object.entries(AVAILABLE_TOKENS)) {
        const balance = await checkTokenBalance(addLog, address, token);
        addLog(chalk.yellow(`  - ${symbol.padEnd(6)}: ${balance.toFixed(6)}`));
    }
}

async function askInput(requestInput, addLog, message, type, defaultValue = '') {
    while (true) {
        try {
            const input = await requestInput(message, type, defaultValue);
            return input;
        } catch (error) {
            addLog(chalk.red('Invalid input, please try again'));
        }
    }
}

function getRandomDelay(minDelay = 10, maxDelay = 30) {
    return Math.random() * (maxDelay - minDelay) + minDelay;
}

function shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

async function verifyContractMethods(addLog) {
    addLog(chalk.cyan('Verifying contract methods...'));
    const routerMethods = [
        'swapExactETHForTokens',
        'swapExactTokensForETH',
        'swapExactTokensForTokens',
        'getAmountsOut',
        'swapETHForExactTokens',
        'swapTokensForExactETH',
        'get_amounts_out'
    ];
    const tokenMethods = ['approve', 'balanceOf', 'decimals', 'allowance', 'approveToken'];

    let validRouterMethod = null;
    let validTokenMethod = null;

    // Test router methods
    for (const method of routerMethods) {
        try {
            await routerContract.methods[method]().call();
            addLog(chalk.cyan(`Router method ${method} verified successfully`));
            if (method.includes('swap')) validRouterMethod = method;
        } catch (error) {
            addLog(chalk.yellow(`Router method ${method} not found: ${error.message}`));
        }
    }

    // Test token methods (using USDC as a representative)
    const tokenContract = new web3.eth.Contract(ABI.token, USDC_CONTRACT);
    for (const method of tokenMethods) {
        try {
            await tokenContract.methods[method]().call();
            addLog(chalk.cyan(`Token method ${method} verified successfully`));
            if (method === 'approve') validTokenMethod = method;
        } catch (error) {
            addLog(chalk.yellow(`Token method ${method} not found: ${error.message}`));
        }
    }

    // Fallback to minimal ABI if no valid swap method found
    if (!validRouterMethod) {
        addLog(chalk.yellow('No valid swap method found. Using fallback ABI for swapExactTokensForTokens...'));
        routerContract = new web3.eth.Contract(FALLBACK_ABI.router, ROUTER_CONTRACT);
        validRouterMethod = 'swapExactTokensForTokens';
    }

    return { validRouterMethod, validTokenMethod };
}

async function approveToken(addLog, updatePanel, privateKey, token, amountWei) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const tokenContract = new web3.eth.Contract(ABI.token, token.address);
        const currentAllowance = await tokenContract.methods.allowance(account.address, ROUTER_CONTRACT).call();
        if (BigInt(currentAllowance) >= BigInt(amountWei)) {
            return true;
        }

        addLog(chalk.cyan(`Approving ${token.name}...`));
        updatePanel(`Approving ${token.name}`);

        const nonce = await web3.eth.getTransactionCount(account.address);
        const maxUint256 = '0x' + 'f'.repeat(64);
        const tx = {
            from: account.address,
            to: token.address,
            data: tokenContract.methods.approve(ROUTER_CONTRACT, maxUint256).encodeABI(),
            nonce,
            chainId: CHAIN_ID,
            gasPrice: await web3.eth.getGasPrice(),
        };

        try {
            tx.gas = Math.floor(await web3.eth.estimateGas(tx) * 1.2);
        } catch {
            tx.gas = 200000;
            addLog(chalk.yellow('Failed to estimate gas. Using default gas: 200000'));
        }

        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        const txUrl = `${EXPLORER_URL}${txHash.transactionHash}`;

        if (txHash.status) {
            addLog(chalk.green(`Successfully approved ${token.name} | Tx: ${txUrl}`));
            return true;
        } else {
            addLog(chalk.red(`Approval of ${token.name} failed | Tx: ${txUrl}`));
            return false;
        }
    } catch (error) {
        addLog(chalk.red(`Approval of ${token.name} failed: ${error.message}`));
        return false;
    }
}

async function swapToken(addLog, updatePanel, privateKey, profileNum, fromToken, toToken, amount, swapTimes, validRouterMethod) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const tokenA = AVAILABLE_TOKENS[fromToken];
        const tokenB = AVAILABLE_TOKENS[toToken];

        if (!tokenA || !tokenB) {
            addLog(chalk.red('Error: Invalid token symbols'));
            return 0;
        }

        let successfulSwaps = 0;
        let nonce = await web3.eth.getTransactionCount(account.address, 'pending');

        for (let i = 1; i <= swapTimes; i++) {
            addLog(chalk.yellow(`Swap ${i}/${swapTimes}: ${fromToken} -> ${toToken}`));
            updatePanel(`Swap ${i}/${swapTimes}: ${fromToken} -> ${toToken}`);

            addLog(chalk.cyan('Checking balance...'));
            const balance = await checkTokenBalance(addLog, account.address, tokenA);
            if (balance < amount) {
                addLog(chalk.red(`Insufficient balance: ${balance.toFixed(4)} ${tokenA.name} < ${amount}`));
                break;
            }

            const amountWei = tokenA.native ? web3.utils.toWei(amount.toString(), 'ether') : BigInt(amount * (10 ** tokenA.decimals)).toString();

            if (!tokenA.native) {
                const approved = await approveToken(addLog, updatePanel, privateKey, tokenA, amountWei);
                if (!approved) break;
                nonce++;
            }

            addLog(chalk.cyan('Preparing transaction...'));
            const path = [
                tokenA.native ? WMON_CONTRACT : tokenA.address,
                tokenB.native ? WMON_CONTRACT : tokenB.address,
            ];

            let expectedOut = amountWei;
            try {
                const amountsOut = await routerContract.methods.getAmountsOut(amountWei, path).call();
                expectedOut = amountsOut[amountsOut.length - 1];
            } catch (error) {
                addLog(chalk.yellow(`Failed to fetch amounts out: ${error.message}. Using input amount as fallback.`));
            }

            const minAmountOut = BigInt(expectedOut) * BigInt(95) / BigInt(100); // 5% slippage
            const deadline = Math.floor(Date.now() / 1000) + 3600;

            let tx;
            if (tokenA.native) {
                tx = {
                    from: account.address,
                    to: ROUTER_CONTRACT,
                    value: amountWei,
                    data: routerContract.methods[validRouterMethod === 'swapExactETHForTokens' ? validRouterMethod : 'swapExactETHForTokens'](minAmountOut, path, account.address, deadline).encodeABI(),
                    nonce,
                    chainId: CHAIN_ID,
                    gasPrice: await web3.eth.getGasPrice(),
                };
            } else if (tokenB.native) {
                tx = {
                    from: account.address,
                    to: ROUTER_CONTRACT,
                    data: routerContract.methods[validRouterMethod === 'swapExactTokensForETH' ? validRouterMethod : 'swapExactTokensForETH'](amountWei, minAmountOut, path, account.address, deadline).encodeABI(),
                    nonce,
                    chainId: CHAIN_ID,
                    gasPrice: await web3.eth.getGasPrice(),
                };
            } else {
                tx = {
                    from: account.address,
                    to: ROUTER_CONTRACT,
                    data: routerContract.methods[validRouterMethod](amountWei, minAmountOut, path, account.address, deadline).encodeABI(),
                    nonce,
                    chainId: CHAIN_ID,
                    gasPrice: await web3.eth.getGasPrice(),
                };
            }

            try {
                tx.gas = Math.floor(await web3.eth.estimateGas(tx) * 1.2);
            } catch {
                tx.gas = 200000;
                addLog(chalk.yellow('Failed to estimate gas. Using default gas: 200000'));
            }

            addLog(chalk.cyan('Sending transaction...'));
            const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
            const txHash = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
            const txUrl = `${EXPLORER_URL}${txHash.transactionHash}`;

            if (txHash.status) {
                successfulSwaps++;
                const monBalance = await checkTokenBalance(addLog, account.address, AVAILABLE_TOKENS['MON']);
                addLog(chalk.green(`Successfully swapped ${amount} ${tokenA.name} -> ${(Number(expectedOut) / (10 ** tokenB.decimals)).toFixed(6)} ${tokenB.name} | Tx: ${txUrl}`));
                addLog(chalk.yellow(`    Address: ${account.address}`));
                addLog(chalk.yellow(`    Block: ${txHash.blockNumber}`));
                addLog(chalk.yellow(`    Gas: ${txHash.gasUsed}`));
                addLog(chalk.yellow(`    Balance: ${monBalance.toFixed(4)} MON`));
            } else {
                addLog(chalk.red(`Swap failed | Tx: ${txUrl}`));
                break;
            }

            nonce++;
            if (i < swapTimes) {
                const delay = Math.random() * (15 - 5) + 5;
                addLog(chalk.yellow(`Pausing ${delay.toFixed(2)} seconds`));
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
        }

        return successfulSwaps;
    } catch (error) {
        addLog(chalk.red(`Error in swapToken: ${error.message}`));
        return 0;
    }
}

// Main exported function for Blessed UI
module.exports = async function(addLog, updatePanel, closeUI, requestInput, lang) {
    addLog(chalk.green('MADNESS SWAP - MONAD TESTNET'));
    updatePanel('Starting Madness Swap Script');

    // Check Web3 connection
    addLog(chalk.cyan('Initializing Web3 connection...'));
    if (!(await web3.eth.net.isListening())) {
        addLog(chalk.red('Failed to connect to Monad Testnet'));
        updatePanel('Error: Failed to connect');
        return;
    }
    addLog(chalk.green(`Success: Connected to Monad Testnet | Chain ID: ${await web3.eth.getChainId()}`));

    // Verify contract methods
    const { validRouterMethod } = await verifyContractMethods(addLog);
    if (!validRouterMethod) {
        addLog(chalk.red('No valid swap method found. Check contract ABI at https://testnet.monadexplorer.com/address/0x64Aff7245EbdAAECAf266852139c67E4D8DBa4de'));
        return;
    }

    // Load private keys
    const privateKeys = loadPrivateKeys(addLog);
    if (!privateKeys.length) {
        addLog(chalk.red('No private keys loaded, exiting program'));
        updatePanel('Error: No private keys found');
        return;
    }
    addLog(chalk.yellow(`Info: Found ${privateKeys.length} wallets`));

    let totalSwaps = 0;
    let successfulSwaps = 0;

    const shuffledKeys = shuffleArray([...privateKeys]);

    for (let i = 0; i < shuffledKeys.length; i++) {
        const { line, key } = shuffledKeys[i];
        const account = web3.eth.accounts.privateKeyToAccount(key);
        addLog(chalk.cyan(`Processing Wallet ${line} (${i + 1}/${privateKeys.length})`));
        addLog(chalk.yellow(`Address: ${account.address}`));
        await displayTokenBalances(addLog, account.address);

        // Display available tokens
        addLog(chalk.cyan('Available Tokens'));
        TOKEN_LIST.forEach((token, idx) => {
            const targets = TOKEN_LIST.filter(t => t !== token).join(' | ');
            addLog(chalk.yellow(`  ${idx + 1}. ${token} <-> ${targets}`));
        });

        // Select token to swap from
        let tokenChoice;
        while (true) {
            tokenChoice = await askInput(requestInput, addLog, `Select token to swap from [1-${TOKEN_LIST.length}]:`, 'number');
            tokenChoice = parseInt(tokenChoice);
            if (tokenChoice >= 1 && tokenChoice <= TOKEN_LIST.length) break;
            addLog(chalk.red(`Invalid choice, please select from 1-${TOKEN_LIST.length}`));
        }
        const fromToken = TOKEN_LIST[tokenChoice - 1];

        // Display swap pairs
        const swapPairs = TOKEN_LIST.filter(t => t !== fromToken);
        addLog(chalk.cyan(`${fromToken} Swap Pairs`));
        swapPairs.forEach((token, idx) => {
            addLog(chalk.yellow(`  ${idx + 1}. ${fromToken} -> ${token}`));
        });

        // Select swap pair
        let pairChoice;
        while (true) {
            pairChoice = await askInput(requestInput, addLog, `Select swap pair [1-${swapPairs.length}]:`, 'number');
            pairChoice = parseInt(pairChoice);
            if (pairChoice >= 1 && pairChoice <= swapPairs.length) break;
            addLog(chalk.red(`Invalid choice, please select from 1-${swapPairs.length}`));
        }
        const toToken = swapPairs[pairChoice - 1];

        // Check balance and prompt for amount
        const tokenBalance = await checkTokenBalance(addLog, account.address, AVAILABLE_TOKENS[fromToken]);
        let amount;
        while (true) {
            amount = await askInput(requestInput, addLog, `Enter amount of ${fromToken} to swap (Max: ${tokenBalance.toFixed(4)}):`, 'number');
            amount = parseFloat(amount);
            if (amount > 0 && amount <= tokenBalance) break;
            addLog(chalk.red('Invalid amount or exceeds balance'));
        }

        // Prompt for number of swaps
        let swapTimes;
        while (true) {
            swapTimes = await askInput(requestInput, addLog, 'Enter number of swaps:', 'number');
            swapTimes = parseInt(swapTimes);
            if (swapTimes > 0) break;
            addLog(chalk.red('Invalid number, please enter a positive integer'));
        }

        // Perform swaps
        const swaps = await swapToken(addLog, updatePanel, key, line, fromToken, toToken, amount, swapTimes, validRouterMethod);
        successfulSwaps += swaps;
        totalSwaps += swapTimes;

        if (i < shuffledKeys.length - 1) {
            const delay = getRandomDelay();
            addLog(chalk.yellow(`Pausing ${delay.toFixed(2)} seconds`));
            updatePanel(`Pausing ${delay.toFixed(2)} seconds`);
            await new Promise(resolve => setTimeout(resolve, delay * 1000));
        }
    }

    addLog(chalk.green(`COMPLETED: ${successfulSwaps}/${totalSwaps} TRANSACTIONS SUCCESSFUL`));
    updatePanel('Madness Swap Script Completed');
};
