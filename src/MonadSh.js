const Web3 = require('web3');
const fs = require('fs');
const chalk = require('chalk');

// Constants
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/0x";
const SHMONAD_ADDRESS = "0x3a98250F98Dd388C211206983453837C8365BDc1";
const DEFAULT_STAKE_POLICY_ID = 4;
const CHAIN_ID = 10143;

// Initialize Web3 provider
const web3 = new Web3(RPC_URL);

// Define MIN_STAKE_AMOUNT after web3 initialization
const MIN_STAKE_AMOUNT = web3.utils.toWei('0.2', 'ether'); // 0.2 shMON, adjust if known

// ABI for shMONAD contract (update with actual ABI from Python script)
const SHMONAD_ABI = [
    {
        "inputs": [
            { "internalType": "uint256", "name": "amount", "type": "uint256" },
            { "internalType": "address", "name": "receiver", "type": "address" }
        ],
        "name": "deposit",
        "outputs": [],
        "stateMutability": "payable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "policyId", "type": "uint256" },
            { "internalType": "address", "name": "staker", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "bond",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "policyId", "type": "uint256" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" },
            { "internalType": "uint256", "name": "index", "type": "uint256" }
        ],
        "name": "unbond",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "policyId", "type": "uint256" },
            { "internalType": "uint256", "name": "index", "type": "uint256" }
        ],
        "name": "claim",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "amount", "type": "uint256" },
            { "internalType": "address", "name": "receiver", "type": "address" },
            { "internalType": "address", "name": "owner", "type": "address" }
        ],
        "name": "redeem",
        "outputs": [],
        "stateMutability": "nonpayable",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "account", "type": "address" }
        ],
        "name": "balanceOf",
        "outputs": [
            { "internalType": "uint256", "name": "", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "uint256", "name": "policyId", "type": "uint256" },
            { "internalType": "address", "name": "account", "type": "address" }
        ],
        "name": "balanceOfBonded",
        "outputs": [
            { "internalType": "uint256", "name": "", "type": "uint256" }
        ],
        "stateMutability": "view",
        "type": "function"
    },
    {
        "inputs": [
            { "internalType": "address", "name": "spender", "type": "address" },
            { "internalType": "uint256", "name": "amount", "type": "uint256" }
        ],
        "name": "approve",
        "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
        "stateMutability": "nonpayable",
        "type": "function"
    }
    // Add isStakingEnabled or getPolicyDetails if present in Python script
];

// Initialize contract
const shmonadContract = new web3.eth.Contract(SHMONAD_ABI, SHMONAD_ADDRESS);

// Utility functions
function loadPrivateKeys(addLog, filePath = 'pvkey.txt') {
    try {
        const keys = fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(line => line);
        if (!keys.length) {
            addLog(chalk.red(`No valid private keys found in ${filePath}`));
            return [];
        }
        return keys;
    } catch (error) {
        if (error.code === 'ENOENT') {
            addLog(chalk.red(`File ${filePath} not found`));
        } else {
            addLog(chalk.red(`Error reading ${filePath}: ${error.message}`));
        }
        return [];
    }
}

async function getBalance(addLog, account, tokenType = 'mon', stakePolicyId) {
    try {
        if (tokenType === 'mon') {
            return await web3.eth.getBalance(account);
        } else if (tokenType === 'shmon') {
            return await shmonadContract.methods.balanceOf(account).call();
        } else if (tokenType === 'bonded') {
            try {
                return await shmonadContract.methods.balanceOfBonded(stakePolicyId, account).call();
            } catch (error) {
                addLog(chalk.yellow(`Warning: balanceOfBonded reverted for policy ID ${stakePolicyId}, assuming 0. Check policy ID: ${error.message}`));
                return '0';
            }
        }
    } catch (error) {
        addLog(chalk.red(`Error fetching ${tokenType} balance: ${error.message}`));
        return '0';
    }
}

async function getMonAmountFromUser(requestInput, addLog) {
    while (true) {
        try {
            const input = await requestInput('Enter MON amount to buy shMON (0.2 - 999):', 'number', '0.2');
            const amount = parseFloat(input);
            if (amount >= 0.2 && amount <= 999) {
                return web3.utils.toWei(amount.toString(), 'ether');
            }
            addLog(chalk.red('Amount must be between 0.2 and 999. Enter a valid number!'));
        } catch (error) {
            addLog(chalk.red('Enter a valid number!'));
        }
    }
}

async function getStakePolicyId(requestInput, addLog) {
    while (true) {
        try {
            const input = await requestInput(`Enter STAKE_POLICY_ID (default ${DEFAULT_STAKE_POLICY_ID}):`, 'number', DEFAULT_STAKE_POLICY_ID.toString());
            const policyId = parseInt(input) || DEFAULT_STAKE_POLICY_ID;
            if (policyId >= 0) return policyId;
            addLog(chalk.red('Policy ID must be a non-negative number!'));
        } catch (error) {
            addLog(chalk.red('Enter a valid number!'));
        }
    }
}

function getRandomDelay(minDelay = 60, maxDelay = 180) {
    return Math.floor(Math.random() * (maxDelay - minDelay + 1)) + minDelay;
}

async function approveShmon(addLog, updatePanel, privateKey, amount) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const wallet = account.address.slice(0, 8) + "...";
        addLog(chalk.yellow(`Approving ${web3.utils.fromWei(amount, 'ether')} shMON for staking | ${wallet}`));
        updatePanel(`Running Approve shMON for ${wallet}`);

        const tx = {
            from: account.address,
            to: SHMONAD_ADDRESS,
            gas: 750000,
            gasPrice: web3.utils.toWei('150', 'gwei'),
            nonce: await web3.eth.getTransactionCount(account.address),
            chainId: CHAIN_ID,
            data: shmonadContract.methods.approve(SHMONAD_ADDRESS, amount.toString()).encodeABI()
        };

        addLog(chalk.cyan('Sending approve transaction...'));
        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        addLog(chalk.yellow(`Tx Approve: ${EXPLORER_URL}${txHash.transactionHash}`));

        if (txHash.status) {
            addLog(chalk.green('Approve shMON successful!'));
            return true;
        } else {
            addLog(chalk.red('Approve transaction failed'));
            return false;
        }
    } catch (error) {
        addLog(chalk.red(`Error in approveShmon: ${error.message}`));
        return false;
    }
}

// Core functions
async function buyShmon(addLog, updatePanel, privateKey, amount) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const wallet = account.address.slice(0, 8) + "...";
        const monBalance = await getBalance(addLog, account.address, 'mon');
        if (BigInt(monBalance) < BigInt(amount)) {
            addLog(chalk.red(`Insufficient MON balance: ${web3.utils.fromWei(monBalance, 'ether')}`));
            return false;
        }

        addLog(chalk.yellow(`Buying ${web3.utils.fromWei(amount, 'ether')} shMON with MON | ${wallet}`));
        updatePanel(`Running Buy shMON for ${wallet}`);
        const tx = {
            from: account.address,
            to: SHMONAD_ADDRESS,
            value: amount,
            gas: 750000,
            gasPrice: web3.utils.toWei('150', 'gwei'),
            nonce: await web3.eth.getTransactionCount(account.address),
            chainId: CHAIN_ID,
            data: shmonadContract.methods.deposit(amount.toString(), account.address).encodeABI()
        };

        addLog(chalk.cyan('Sending transaction...'));
        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        addLog(chalk.yellow(`Tx: ${EXPLORER_URL}${txHash.transactionHash}`));

        if (txHash.status) {
            addLog(chalk.green('Buy shMON successful!'));
            return true;
        } else {
            addLog(chalk.red('Transaction failed'));
            return false;
        }
    } catch (error) {
        addLog(chalk.red(`Error in buyShmon: ${error.message}`));
        return false;
    }
}

async function stakeShmon(addLog, updatePanel, privateKey, amount, stakePolicyId) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const wallet = account.address.slice(0, 8) + "...";
        const shmonBalance = await getBalance(addLog, account.address, 'shmon');
        if (BigInt(shmonBalance) < BigInt(amount)) {
            addLog(chalk.red(`Insufficient shMON balance: ${web3.utils.fromWei(shmonBalance, 'ether')} (required: ${web3.utils.fromWei(amount, 'ether')})`));
            return false;
        }
        if (BigInt(amount) < BigInt(MIN_STAKE_AMOUNT)) {
            addLog(chalk.red(`Stake amount too low: ${web3.utils.fromWei(amount, 'ether')} shMON (minimum: ${web3.utils.fromWei(MIN_STAKE_AMOUNT, 'ether')})`));
            return false;
        }

        // Approve shMON for staking
        if (!(await approveShmon(addLog, updatePanel, privateKey, amount))) {
            addLog(chalk.red('Skipping staking due to approve failure'));
            return false;
        }

        addLog(chalk.yellow(`Staking ${web3.utils.fromWei(amount, 'ether')} shMON with policy ID ${stakePolicyId} | ${wallet}`));
        updatePanel(`Running Stake shMON for ${wallet}`);

        // Try multiple policy IDs
        const policyIds = [stakePolicyId, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
        let validPolicyId = null;
        for (const pid of policyIds) {
            try {
                await shmonadContract.methods.bond(pid, account.address, amount.toString()).call({ from: account.address });
                addLog(chalk.cyan(`Bond call simulation successful for policy ID ${pid}`));
                validPolicyId = pid;
                break;
            } catch (error) {
                addLog(chalk.yellow(`Bond call simulation failed for policy ID ${pid}: ${error.message}`));
            }
        }

        if (!validPolicyId) {
            addLog(chalk.red('No valid policy ID found. Check contract source code, verify staking is enabled, or try higher stake amount (e.g., 0.5 MON).'));
            addLog(chalk.red('Run test.js to query valid policy IDs or check https://testnet.monadexplorer.com/address/0x3a98250F98Dd388C211206983453837C8365BDc1'));
            return false;
        }

        const tx = {
            from: account.address,
            to: SHMONAD_ADDRESS,
            gas: 750000,
            gasPrice: web3.utils.toWei('150', 'gwei'),
            nonce: await web3.eth.getTransactionCount(account.address),
            chainId: CHAIN_ID,
            data: shmonadContract.methods.bond(validPolicyId, account.address, amount.toString()).encodeABI()
        };

        addLog(chalk.cyan('Sending transaction...'));
        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        addLog(chalk.yellow(`Tx: ${EXPLORER_URL}${txHash.transactionHash}`));

        if (txHash.status) {
            addLog(chalk.green('Stake shMON successful!'));
            return true;
        } else {
            addLog(chalk.red('Transaction failed'));
            return false;
        }
    } catch (error) {
        addLog(chalk.red(`Error in stakeShmon: ${error.message}`));
        return false;
    }
}

async function unstakeShmon(addLog, updatePanel, privateKey, stakePolicyId) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const wallet = account.address.slice(0, 8) + "...";
        const bondedBalance = await getBalance(addLog, account.address, 'bonded', stakePolicyId);
        if (BigInt(bondedBalance) === 0n) {
            addLog(chalk.red('No staked shMON available'));
            return false;
        }

        addLog(chalk.yellow(`Unstaking ${web3.utils.fromWei(bondedBalance, 'ether')} shMON with policy ID ${stakePolicyId} | ${wallet}`));
        updatePanel(`Running Unstake shMON for ${wallet}`);

        // Unbond transaction
        const txUnbond = {
            from: account.address,
            to: SHMONAD_ADDRESS,
            gas: 750000,
            gasPrice: web3.utils.toWei('150', 'gwei'),
            nonce: await web3.eth.getTransactionCount(account.address),
            chainId: CHAIN_ID,
            data: shmonadContract.methods.unbond(stakePolicyId, bondedBalance.toString(), bondedBalance.toString()).encodeABI()
        };

        addLog(chalk.cyan('Sending unbond transaction...'));
        const signedTxUnbond = await web3.eth.accounts.signTransaction(txUnbond, privateKey);
        const txHashUnbond = await web3.eth.sendSignedTransaction(signedTxUnbond.rawTransaction);
        addLog(chalk.yellow(`Tx Unbond: ${EXPLORER_URL}${txHashUnbond.transactionHash}`));

        if (!txHashUnbond.status) {
            addLog(chalk.red('Unbond transaction failed'));
            return false;
        }

        // Wait before claim
        const waitTime = getRandomDelay(40, 60);
        addLog(chalk.yellow(`Waiting ${waitTime} seconds before claiming...`));
        updatePanel(`Waiting ${waitTime} seconds`);
        await new Promise(resolve => setTimeout(resolve, waitTime * 1000));

        // Claim transaction
        const txClaim = {
            from: account.address,
            to: SHMONAD_ADDRESS,
            gas: 750000,
            gasPrice: web3.utils.toWei('150', 'gwei'),
            nonce: await web3.eth.getTransactionCount(account.address),
            chainId: CHAIN_ID,
            data: shmonadContract.methods.claim(stakePolicyId, bondedBalance.toString()).encodeABI()
        };

        addLog(chalk.cyan('Sending claim transaction...'));
        const signedTxClaim = await web3.eth.accounts.signTransaction(txClaim, privateKey);
        const txHashClaim = await web3.eth.sendSignedTransaction(signedTxClaim.rawTransaction);
        addLog(chalk.yellow(`Tx Claim: ${EXPLORER_URL}${txHashClaim.transactionHash}`));

        if (txHashClaim.status) {
            addLog(chalk.green('Unstake shMON successful!'));
            return true;
        } else {
            addLog(chalk.red('Claim transaction failed'));
            return false;
        }
    } catch (error) {
        addLog(chalk.red(`Error in unstakeShmon: ${error.message}`));
        return false;
    }
}

async function sellShmon(addLog, updatePanel, privateKey, amount) {
    try {
        const account = web3.eth.accounts.privateKeyToAccount(privateKey);
        const wallet = account.address.slice(0, 8) + "...";
        const shmonBalance = await getBalance(addLog, account.address, 'shmon');
        if (BigInt(shmonBalance) < BigInt(amount)) {
            addLog(chalk.red(`Insufficient shMON balance: ${web3.utils.fromWei(shmonBalance, 'ether')} (required: ${web3.utils.fromWei(amount, 'ether')})`));
            return false;
        }

        addLog(chalk.yellow(`Selling ${web3.utils.fromWei(amount, 'ether')} shMON | ${wallet}`));
        updatePanel(`Running Sell shMON for ${wallet}`);
        const tx = {
            from: account.address,
            to: SHMONAD_ADDRESS,
            gas: 750000,
            gasPrice: web3.utils.toWei('150', 'gwei'),
            nonce: await web3.eth.getTransactionCount(account.address),
            chainId: CHAIN_ID,
            data: shmonadContract.methods.redeem(amount.toString(), account.address, account.address).encodeABI()
        };

        addLog(chalk.cyan('Sending transaction...'));
        const signedTx = await web3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await web3.eth.sendSignedTransaction(signedTx.rawTransaction);
        addLog(chalk.yellow(`Tx: ${EXPLORER_URL}${txHash.transactionHash}`));

        if (txHash.status) {
            addLog(chalk.green('Sell shMON successful!'));
            return true;
        } else {
            addLog(chalk.red('Transaction failed'));
            return false;
        }
    } catch (error) {
        addLog(chalk.red(`Error in sellShmon: ${error.message}`));
        return false;
    }
}

// Main exported function for Blessed UI
module.exports = async function(addLog, updatePanel, closeUI, requestInput, lang) {
    addLog(chalk.green('SHMONAD - MONAD TESTNET'));
    updatePanel('Starting Shmonad Script');

    addLog(chalk.cyan('Web3 initialized successfully'));

    const privateKeys = loadPrivateKeys(addLog, 'pvkey.txt');
    if (!privateKeys.length) {
        addLog(chalk.red('No private keys loaded, exiting program'));
        updatePanel('Error: No private keys found');
        return;
    }

    addLog(chalk.cyan(`Accounts: ${privateKeys.length}`));

    // Prompt for STAKE_POLICY_ID early
    const STAKE_POLICY_ID = await getStakePolicyId(requestInput, addLog);
    addLog(chalk.cyan(`Using STAKE_POLICY_ID: ${STAKE_POLICY_ID}`));

    let cycles;
    while (true) {
        try {
            const input = await requestInput('Enter number of cycles (default 1):', 'number', '1');
            cycles = parseInt(input) || 1;
            if (cycles > 0) break;
            addLog(chalk.red('Number must be greater than 0'));
        } catch (error) {
            addLog(chalk.red('Enter a valid number'));
        }
    }

    addLog(chalk.yellow(`Running ${cycles} shMON cycles...`));
    updatePanel(`Running ${cycles} shMON cycles`);

    for (let cycle = 1; cycle <= cycles; cycle++) {
        for (const pk of privateKeys) {
            const account = web3.eth.accounts.privateKeyToAccount(pk);
            const wallet = account.address.slice(0, 8) + "...";
            addLog(chalk.cyan(`CYCLE ${cycle}/${cycles} | Account: ${wallet}`));
            updatePanel(`Cycle ${cycle}/${cycles} for ${wallet}`);

            // Fetch balances
            const monBalance = await getBalance(addLog, account.address, 'mon');
            const shmonBalance = await getBalance(addLog, account.address, 'shmon');
            const bondedBalance = await getBalance(addLog, account.address, 'bonded', STAKE_POLICY_ID);

            addLog(chalk.yellow(`Balances: MON: ${web3.utils.fromWei(monBalance, 'ether')}, shMON: ${web3.utils.fromWei(shmonBalance, 'ether')}, Bonded shMON: ${web3.utils.fromWei(bondedBalance, 'ether')}`));

            // Get MON amount to buy
            const amount = await getMonAmountFromUser(requestInput, addLog);

            // Buy shMON
            if (BigInt(monBalance) > BigInt(amount)) {
                if (await buyShmon(addLog, updatePanel, pk, amount)) {
                    await new Promise(resolve => setTimeout(resolve, 5000));
                    const newShmonBalance = await getBalance(addLog, account.address, 'shmon');
                    addLog(chalk.cyan(`New shMON balance after buy: ${web3.utils.fromWei(newShmonBalance, 'ether')}`));

                    // Stake shMON
                    if (BigInt(newShmonBalance) > 0) {
                        if (await stakeShmon(addLog, updatePanel, pk, newShmonBalance, STAKE_POLICY_ID)) {
                            await new Promise(resolve => setTimeout(resolve, 5000));
                            const newBondedBalance = await getBalance(addLog, account.address, 'bonded', STAKE_POLICY_ID);

                            // Unstake shMON
                            if (BigInt(newBondedBalance) > 0) {
                                if (await unstakeShmon(addLog, updatePanel, pk, STAKE_POLICY_ID)) {
                                    await new Promise(resolve => setTimeout(resolve, 5000));
                                    const finalShmonBalance = await getBalance(addLog, account.address, 'shmon');

                                    // Sell shMON
                                    if (BigInt(finalShmonBalance) > 0) {
                                        await sellShmon(addLog, updatePanel, pk, finalShmonBalance);
                                    } else {
                                        addLog(chalk.yellow('No shMON to sell'));
                                    }
                                }
                            } else {
                                addLog(chalk.yellow('No bonded shMON to unstake'));
                            }
                        } else {
                            addLog(chalk.yellow('Skipping staking due to bond failure'));
                        }
                    } else {
                        addLog(chalk.yellow('No shMON to stake'));
                    }
                }
            } else {
                addLog(chalk.red('Insufficient MON to buy shMON'));
            }

            // Delay between accounts or cycles
            if (cycle < cycles || pk !== privateKeys[privateKeys.length - 1]) {
                const delay = getRandomDelay();
                addLog(chalk.yellow(`Waiting ${delay} seconds...`));
                updatePanel(`Waiting ${delay} seconds`);
                await new Promise(resolve => setTimeout(resolve, delay * 1000));
            }
        }
    }

    addLog(chalk.green('ALL DONE'));
    updatePanel('Shmonad Script Completed');
};
