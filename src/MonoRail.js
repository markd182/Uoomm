const Web3 = require('web3');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URLS = [
  'https://testnet-rpc.monorail.xyz',
  'https://testnet-rpc.monad.xyz',
  'https://monad-testnet.drpc.org',
];
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const CONTRACT_ADDRESS = '0xC995498c22a012353FAE7eCC701810D673E25794';

// Utility Functions
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const randomInRange = (min, max) => Math.random() * (max - min) + min;

// Generate random delay (1–3 minutes)
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
  const errorMsg = chalk.red('❌ Không kết nối được với bất kỳ RPC nào');
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
    const errorMsg = chalk.red(`❌ Lỗi đọc file pvkey.txt: ${e.message}`);
    safeLog(errorMsg, addLog);
    safeUpdatePanel(errorMsg, updatePanel);
    return [];
  }
}

// Language translations
const translations = {
  vi: {
    title: 'MONORAIL - MONAD TESTNET',
    accounts: 'Tài khoản',
    account: 'TÀI KHOẢN / ACCOUNT',
    checking: 'Đang kiểm tra số dư...',
    balance: 'Số dư',
    insufficient: 'Số dư không đủ để thực hiện giao dịch!',
    start: (walletShort) => `Khởi động Monorail cho ${walletShort}`,
    sending: 'Đang gửi giao dịch...',
    sent: 'Giao dịch đã gửi! Đang chờ xác nhận...',
    success: 'Giao dịch thành công!',
    fail: (error) => `Lỗi xảy ra: ${error}`,
    explorer: (txHash) => `🔗 Explorer: ${EXPLORER_URL}${txHash}`,
    gasFail: (error) => `Không thể ước lượng gas. Dùng gas mặc định: ${error}`,
    wait: (minutes) => `⏳ Đợi ${minutes} phút trước tài khoản tiếp theo...`,
    done: (count) => `HOÀN TẤT - ${count} TÀI KHOẢN`,
    revertReason: (reason) => `Lý do giao dịch bị hủy: ${reason}`,
    pending: 'Có giao dịch đang chờ xử lý, bỏ qua ví này...',
    debug: (tx) => `Thông tin giao dịch: To=${tx.to}, Value=${tx.value}, Data=${tx.data.slice(0, 50)}...`,
  },
  en: {
    title: 'MONORAIL - MONAD TESTNET',
    accounts: 'Accounts',
    account: 'ACCOUNT',
    checking: 'Checking balance...',
    balance: 'Balance',
    insufficient: 'Insufficient balance for transaction!',
    start: (walletShort) => `Starting Monorail for ${walletShort}`,
    sending: 'Sending transaction...',
    sent: 'Transaction sent! Waiting for confirmation...',
    success: 'Transaction successful!',
    fail: (error) => `Error occurred: ${error}`,
    explorer: (txHash) => `🔗 Explorer: ${EXPLORER_URL}${txHash}`,
    gasFail: (error) => `Gas estimation failed. Using default gas limit: ${error}`,
    wait: (minutes) => `⏳ Waiting ${minutes} minutes before next account...`,
    done: (count) => `ALL DONE - ${count} ACCOUNTS`,
    revertReason: (reason) => `Transaction revert reason: ${reason}`,
    pending: 'Pending transaction detected, skipping this wallet...',
    debug: (tx) => `Transaction details: To=${tx.to}, Value=${tx.value}, Data=${tx.data.slice(0, 50)}...`,
  },
};

// Print header (no square borders)
function printHeader(text, color = chalk.cyan) {
  return `${color(`--- ${text} ---`)}`;
}

// Check balance
async function checkBalance(w3, walletAddress, language, addLog) {
  const lang = translations[language] || translations.vi;
  safeLog(chalk.yellow(`🔍 ${lang.checking}`), addLog);
  try {
    const balance = await w3.eth.getBalance(walletAddress);
    const balanceEth = w3.utils.fromWei(balance, 'ether');
    safeLog(chalk.cyan(`💰 ${lang.balance}: ${balanceEth} MONAD`), addLog);

    // Require 0.1 MON + 0.01 MON for gas
    const minBalance = w3.utils.toWei('0.11', 'ether');
    if (balance < minBalance) {
      safeLog(chalk.red(`❌ ${lang.insufficient}`), addLog);
      return false;
    }
    return true;
  } catch (e) {
    safeLog(chalk.red(`❌ Lỗi kiểm tra số dư: ${e.message}`), addLog);
    return false;
  }
}

// Get revert reason
async function getRevertReason(w3, tx, addLog, lang) {
  try {
    await w3.eth.call(tx, 'latest');
    return null; // No revert
  } catch (e) {
    const reason = e.message.includes('revert') ? e.message : 'Unknown revert reason';
    safeLog(chalk.red(`⚠ ${lang.revertReason(reason)}`), addLog);
    return reason;
  }
}

// Send transaction
async function sendTransaction(w3, privateKey, language, addLog, maxRetries = 3) {
  const lang = translations[language] || translations.vi;
  try {
    const account = w3.eth.accounts.privateKeyToAccount(privateKey);
    const walletAddress = account.address;
    const walletShort = walletAddress.slice(0, 8) + '...';

    safeLog(printHeader(lang.start(walletShort), chalk.blue), addLog);

    // Check balance
    if (!(await checkBalance(w3, walletAddress, language, addLog))) {
      return false;
    }

    // Check for pending transactions
    const pendingCount = await w3.eth.getTransactionCount(walletAddress, 'pending');
    const confirmedCount = await w3.eth.getTransactionCount(walletAddress, 'latest');
    if (pendingCount > confirmedCount) {
      safeLog(chalk.yellow(`⚠ ${lang.pending}`), addLog);
      return false;
    }

    const data = '0x96f25cbe0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000e0590015a873bf326bd645c3e1266d4db41c4e6b000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001a0000000000000000000000000' + walletAddress.replace('0x', '').toLowerCase() + '000000000000000000000000000000000000000000000000542f8f7c3d64ce470000000000000000000000000000000000000000000000000000002885eeed340000000000000000000000000000000000000000000000000000000000000004000000000000000000000000760afe86e5de5fa0ee542fc7b7b713e1c5425701000000000000000000000000760afe86e5de5fa0ee542fc7b7b713e1c5425701000000000000000000000000cba6b9a951749b8735c603e7ffc5151849248772000000000000000000000000760afe86e5de5fa0ee542fc7b7b713e1c54257010000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000008000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000014000000000000000000000000000000000000000000000000000000000000002800000000000000000000000000000000000000000000000000000000000000004d0e30db0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000cba6b9a951749b8735c603e7ffc5151849248772000000000000000000000000000000000000000000000000016345785d8a000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000010438ed1739000000000000000000000000000000000000000000000000016345785d8a0000000000000000000000000000000000000000000000000000542f8f7c3d64ce4700000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000c995498c22a012353fae7ecc701810d673e257940000000000000000000000000000000000000000000000000000002885eeed340000000000000000000000000000000000000000000000000000000000000002000000000000000000000000760afe86e5de5fa0ee542fc7b7b713e1c5425701000000000000000000000000e0590015a873bf326bd645c3e1266d4db41c4e6b000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000044095ea7b3000000000000000000000000cba6b9a951749b8735c603e7ffc5151849248772000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000';
    const value = w3.utils.toWei('0.1', 'ether');

    let gasLimit = 800000; // Increased default gas limit
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        gasLimit = await w3.eth.estimateGas({
          from: walletAddress,
          to: CONTRACT_ADDRESS,
          value: value,
          data: data,
        });
        break;
      } catch (e) {
        if (attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(chalk.yellow(`⚠ ${lang.gasFail(e.message)} Retrying in ${delay / 1000}s...`), addLog);
          await sleep(delay);
        } else {
          safeLog(chalk.yellow(`⚠ ${lang.gasFail(e.message)} Using default gas limit.`), addLog);
        }
      }
    }

    let nonce = await w3.eth.getTransactionCount(walletAddress, 'pending');
    const tx = {
      from: walletAddress,
      to: CONTRACT_ADDRESS,
      data: data,
      value: value,
      gas: gasLimit,
      gasPrice: await w3.eth.getGasPrice() * 1.5,
      nonce: nonce,
      chainId: 10143, // Monad testnet chain ID
    };

    // Log transaction details for debugging
    safeLog(chalk.cyan(lang.debug(tx)), addLog);

    // Check for revert reason
    await getRevertReason(w3, tx, addLog, lang);

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        safeLog(chalk.blue(`🚀 ${lang.sending}`), addLog);
        const signedTx = await w3.eth.accounts.signTransaction(tx, privateKey);
        const txHash = await w3.eth.sendSignedTransaction(signedTx.rawTransaction);

        safeLog(chalk.green(`✅ ${lang.sent}`), addLog);
        await sleep(1000); // Wait for confirmation

        safeLog(chalk.green(`🎉 ${lang.success}`), addLog);
        safeLog(chalk.cyan(lang.explorer(txHash.transactionHash)), addLog);
        return true;
      } catch (e) {
        if (e.message.includes('nonce too low')) {
          nonce++; // Increment nonce
          tx.nonce = nonce;
          safeLog(chalk.yellow(`⚠ Nonce too low, incrementing to ${nonce} and retrying...`), addLog);
        } else if ((e.message.includes('revert') || e.message.includes('429')) && attempt < maxRetries - 1) {
          const delay = 1000 * 2 ** attempt; // Exponential backoff: 1s, 2s, 4s
          safeLog(chalk.yellow(`⚠ Transaction failed, retrying in ${delay / 1000}s: ${e.message}`), addLog);
          await sleep(delay);
          // Try with higher gas on retry
          tx.gas = Math.min(tx.gas + 200000, 1000000);
        } else {
          safeLog(chalk.red(`❌ ${lang.fail(e.message)}`), addLog);
          return false;
        }
      }
    }
    return false;
  } catch (e) {
    safeLog(chalk.red(`❌ ${lang.fail(e.message)}`), addLog);
    return false;
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput, language = 'vi') => {
  const w3 = await connectToRpc(addLog, updatePanel);
  const lang = translations[language] || translations.vi;

  // Update address with checksum
  const contractAddress = w3.utils.toChecksumAddress(CONTRACT_ADDRESS);

  safeLog(printHeader(lang.title, chalk.green), addLog);
  safeUpdatePanel(chalk.green(`--- ${lang.title} ---`), updatePanel);

  const privateKeys = await loadPrivateKeys(addLog, updatePanel);
  if (!privateKeys.length) {
    safeLog(chalk.red(`❌ No private keys loaded, exiting`), addLog);
    return;
  }

  safeLog(chalk.cyan(`👥 ${lang.accounts}: ${privateKeys.length}`), addLog);
  safeUpdatePanel(chalk.cyan(`👥 ${lang.accounts}: ${privateKeys.length}`), updatePanel);

  for (let idx = 0; idx < privateKeys.length; idx++) {
    const privateKey = privateKeys[idx];
    const walletShort = w3.eth.accounts.privateKeyToAccount(privateKey).address.slice(0, 8) + '...';
    const accountMsg = `${lang.account} ${idx + 1}/${privateKeys.length} | ${walletShort}`;
    safeLog(printHeader(accountMsg, chalk.cyan), addLog);
    safeUpdatePanel(chalk.cyan(accountMsg), updatePanel);

    await sendTransaction(w3, privateKey, language, addLog);

    if (idx < privateKeys.length - 1) {
      const delay = getRandomDelay();
      const minutes = (delay / 60000).toFixed(1);
      safeLog(chalk.yellow(lang.wait(minutes)), addLog);
      safeUpdatePanel(chalk.yellow(lang.wait(minutes)), updatePanel);
      await sleep(delay);
    }
  }

  const completionMsg = `
${chalk.green(`--- ${lang.done(privateKeys.length)} ---`)}
`;
  safeLog(completionMsg, addLog);
  safeUpdatePanel(completionMsg, updatePanel);
};
