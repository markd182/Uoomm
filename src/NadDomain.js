const Web3 = require('web3');
const axios = require('axios');
const chalk = require('chalk');
const fs = require('fs').promises;

// Constants
const RPC_URL = 'https://testnet-rpc.monad.xyz/';
const EXPLORER_URL = 'https://testnet.monadexplorer.com/tx/';
const NAD_CONTRACT_ADDRESS = '0x758D80767a751fc1634f579D76e1CcaAb3485c9c';
const NAD_API_URL = 'https://api.nad.domains/register/signature';
const NAD_NFT_ADDRESS = '0x3019BF1dfB84E5b46Ca9D0eEC37dE08a59A41308';
const BORDER_WIDTH = 80;
const ATTEMPTS = 3;
const PAUSE_BETWEEN_ACTIONS = [5, 15];
const MIN_MON_BALANCE = 0.1; // Minimum MON for gas and fees (in ether)
const DEFAULT_GAS_FEE = Web3.utils.toWei('10', 'gwei'); // Default 10 Gwei for gas fees

// ABI for NAD NFT (ERC721)
const NAD_NFT_ABI = [
  {
    inputs: [{ internalType: 'address', name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

// ABI for NAD Domains
const NAD_ABI = [
  {
    inputs: [
      {
        components: [
          { internalType: 'string', name: 'name', type: 'string' },
          { internalType: 'address', name: 'nameOwner', type: 'address' },
          { internalType: 'bool', name: 'setAsPrimaryName', type: 'bool' },
          { internalType: 'address', name: 'referrer', type: 'address' },
          { internalType: 'bytes32', name: 'discountKey', type: 'bytes32' },
          { internalType: 'bytes', name: 'discountClaimProof', type: 'bytes' },
          { internalType: 'uint256', name: 'nonce', type: 'uint256' },
          { internalType: 'uint256', name: 'deadline', type: 'uint256' },
        ],
        internalType: 'struct NadRegistrarController.RegisterParams',
        name: 'params',
        type: 'tuple',
      },
      { internalType: 'bytes', name: 'signature', type: 'bytes' },
    ],
    name: 'registerWithSignature',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { internalType: 'string', name: 'name', type: 'string' },
          { internalType: 'address', name: 'nameOwner', type: 'address' },
          { internalType: 'bool', name: 'setAsPrimaryName', type: 'bool' },
          { internalType: 'address', name: 'referrer', type: 'address' },
          { internalType: 'bytes32', name: 'discountKey', type: 'bytes32' },
          { internalType: 'bytes', name: 'discountClaimProof', type: 'bytes' },
        ],
        internalType: 'struct NadRegistrarController.RegisterParamsBase',
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'calculateRegisterFee',
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
      check: 'CHECK',
      register: 'REGISTER',
    },
    vi: {
      balance: 'SỐ DƯ',
      check: 'KIỂM TRA',
      register: 'ĐĂNG KÝ',
    },
  };
  const stepText = steps[lang][step] || step;
  const formattedStep = `${chalk.yellow('➤')} ${chalk.cyan(stepText.padEnd(15))} | ${message}`;
  safeLog(formattedStep, addLog);
}

// Language translations
const translations = {
  en: {
    title: 'NAD DOMAINS - MONAD TESTNET',
    accounts: 'Accounts',
    account: 'ACCOUNT',
    startMsg: (accounts) => `Started domain registration for ${accounts} accounts`,
    done: (accounts, success) => `ALL DONE - ${accounts} ACCOUNTS, ${success} SUCCESSFUL`,
    balance: (amount) => `NAD domain balance: ${amount}`,
    monBalance: (amount) => `MON balance: ${amount} MON`,
    insufficientMon: (balance) => `❌ Insufficient MON balance: ${balance} MON (minimum required ${MIN_MON_BALANCE} MON)`,
    check: (name) => `Checking availability of ${name}...`,
    available: (name) => `Domain ${name} is available`,
    unavailable: (name) => `Domain ${name} is not available`,
    signature: 'Requesting signature from API...',
    signatureSuccess: (name) => `Received signature for domain ${name}`,
    signatureFail: (name) => `Failed to get signature for ${name}`,
    register: (name) => `Registering domain ${name}...`,
    registerSuccess: (name, txHash) => `Successfully registered ${name}! TX: ${EXPLORER_URL}${txHash}`,
    registerFail: (name, txHash) => `Failed to register ${name}: ${txHash ? EXPLORER_URL + txHash : 'No TX'}`,
    fee: (amount) => `Fee: ${amount} MON`,
    defaultFee: (length, amount) => `Default fee (${length} characters): ${amount} MON`,
    hasDomain: (balance) => `Wallet already owns ${balance} NAD domain(s)`,
    noDomain: 'Wallet has no NAD domains yet',
    skip: 'Skipping registration as requested',
    prompt: 'Enter domain name to register (Enter for random): ',
    confirm: 'Wallet already has a NAD domain. Do you want to register another? (y/n): ',
    waitAccount: (seconds) => `⏳ Waiting ${seconds}s before next account...`,
    feeWarning: 'On-chain fee calculation disabled due to contract issues. Using default fees.',
    invalidNonce: (name) => `Invalid nonce for ${name}. Using default nonce (0).`,
  },
  vi: {
    title: 'NAD DOMAINS - MONAD TESTNET',
    accounts: 'Tài khoản',
    account: 'TÀI KHOẢN',
    startMsg: (accounts) => `Đã bắt đầu đăng ký tên miền cho ${accounts} tài khoản`,
    done: (accounts, success) => `HOÀN TẤT - ${accounts} TÀI KHOẢN, ${success} THÀNH CÔNG`,
    balance: (amount) => `Số dư tên miền NAD: ${amount}`,
    monBalance: (amount) => `Số dư MON: ${amount} MON`,
    insufficientMon: (balance) => `❌ Số dư MON không đủ: ${balance} MON (yêu cầu tối thiểu ${MIN_MON_BALANCE} MON)`,
    check: (name) => `Đang kiểm tra tính khả dụng của ${name}...`,
    available: (name) => `Tên miền ${name} có sẵn`,
    unavailable: (name) => `Tên miền ${name} không có sẵn`,
    signature: 'Đang yêu cầu chữ ký từ API...',
    signatureSuccess: (name) => `Đã nhận chữ ký cho tên miền ${name}`,
    signatureFail: (name) => `Không thể lấy chữ ký cho ${name}`,
    register: (name) => `Đang đăng ký tên miền ${name}...`,
    registerSuccess: (name, txHash) => `Đã đăng ký thành công ${name}! TX: ${EXPLORER_URL}${txHash}`,
    registerFail: (name, txHash) => `Không thể đăng ký ${name}: ${txHash ? EXPLORER_URL + txHash : 'Không có TX'}`,
    fee: (amount) => `Phí: ${amount} MON`,
    defaultFee: (length, amount) => `Phí mặc định (${length} ký tự): ${amount} MON`,
    hasDomain: (balance) => `Ví đã sở hữu ${balance} tên miền NAD`,
    noDomain: 'Ví chưa sở hữu tên miền NAD nào',
    skip: 'Bỏ qua đăng ký theo yêu cầu',
    prompt: 'Nhập tên miền bạn muốn đăng ký (Enter để dùng ngẫu nhiên): ',
    confirm: 'Ví đã có tên miền NAD. Bạn có muốn đăng ký thêm không? (y/n): ',
    waitAccount: (seconds) => `⏳ Đợi ${seconds}s trước tài khoản tiếp theo...`,
    feeWarning: 'Tính phí on-chain bị vô hiệu hóa do vấn đề hợp đồng. Sử dụng phí mặc định.',
    invalidNonce: (name) => `Nonce không hợp lệ cho ${name}. Sử dụng nonce mặc định (0).`,
  },
};

// NadDomains class
class NadDomains {
  constructor(accountIndex, privateKey, w3) {
    this.accountIndex = accountIndex;
    this.privateKey = privateKey;
    this.w3 = w3;
    this.account = w3.eth.accounts.privateKeyToAccount(privateKey);
    this.walletShort = this.account.address.slice(0, 8) + '...';
    this.contract = new w3.eth.Contract(NAD_ABI, w3.utils.toChecksumAddress(NAD_CONTRACT_ADDRESS));
    this.nftContract = new w3.eth.Contract(NAD_NFT_ABI, w3.utils.toChecksumAddress(NAD_NFT_ADDRESS));
    this.language = 'en'; // Default to English
  }

  async getGasParams(addLog) {
    const messages = translations[this.language];
    printStep('check', messages.signature, this.language, addLog);
    try {
      // Use hardcoded safe gas values to avoid overflow
      const gasParams = {
        maxFeePerGas: this.w3.utils.toBN(DEFAULT_GAS_FEE),
        maxPriorityFeePerGas: this.w3.utils.toBN(DEFAULT_GAS_FEE).div(this.w3.utils.toBN(2)),
      };
      safeLog(`[${this.accountIndex}] Gas params: ${JSON.stringify(gasParams)}`, addLog);
      return gasParams;
    } catch (e) {
      await this._handleError('get_gas_params', e, addLog);
      throw e;
    }
  }

  generateRandomName(minLength = 6, maxLength = 12) {
    const length = Math.floor(randomInRange(minLength, maxLength));
    const characters = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let name = Array.from({ length }, () => characters[Math.floor(Math.random() * characters.length)]).join('');
    if (/^\d/.test(name)) {
      name = characters[Math.floor(Math.random() * 26)] + name.slice(1);
    }
    return name;
  }

  async getSignature(name, addLog) {
    const messages = translations[this.language];
    printStep('check', messages.signature, this.language, addLog);
    const headers = {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'en-US,en;q=0.9',
      origin: 'https://app.nad.domains',
      referer: 'https://app.nad.domains/',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-site',
    };
    const params = {
      name,
      nameOwner: this.account.address,
      setAsPrimaryName: true,
      referrer: '0x0000000000000000000000000000000000000000',
      discountKey: '0x0000000000000000000000000000000000000000000000000000000000000000',
      discountClaimProof: '0x0000000000000000000000000000000000000000000000000000000000000000',
      chainId: '10143',
    };
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        const response = await axios.get(NAD_API_URL, { params, headers });
        if (response.status !== 200) {
          safeLog(`[${this.accountIndex}] API error: Status code ${response.status}`, addLog);
          printStep('check', chalk.red(`✘ ${messages.signatureFail(name)}: Status code ${response.status}`), this.language, addLog);
          return null;
        }
        const data = response.data;
        safeLog(`[${this.accountIndex}] Raw API response: ${JSON.stringify(data)}`, addLog);
        if (data.success) {
          const nonce = Number.isSafeInteger(parseInt(data.nonce)) ? parseInt(data.nonce) : 0;
          if (!Number.isSafeInteger(nonce)) {
            safeLog(`[${this.accountIndex}] Invalid nonce: ${data.nonce}. Using default (0)`, addLog);
            printStep('check', chalk.yellow(`⚠ ${messages.invalidNonce(name)}`), this.language, addLog);
          }
          safeLog(`[${this.accountIndex}] Got signature for domain ${name}, nonce: ${nonce}`, addLog);
          printStep('check', chalk.green(`✔ ${messages.signatureSuccess(name)}`), this.language, addLog);
          return {
            signature: data.signature,
            nonce: nonce,
            deadline: parseInt(data.deadline) || 0,
          };
        } else {
          safeLog(`[${this.accountIndex}] API error: ${data.message || 'Unknown error'}`, addLog);
          printStep('check', chalk.red(`✘ ${messages.signatureFail(name)}: ${data.message || 'Unknown error'}`), this.language, addLog);
          return null;
        }
      } catch (e) {
        await this._handleError('get_signature', e, addLog);
      }
    }
    printStep('check', chalk.red(`✘ ${messages.signatureFail(name)} after ${ATTEMPTS} attempts`), this.language, addLog);
    return null;
  }

  async calculateFee(name, addLog) {
    const messages = translations[this.language];
    printStep('register', messages.register(name), this.language, addLog);
    // Temporarily disable on-chain fee calculation due to persistent reverts
    safeLog(`[${this.accountIndex}] On-chain fee calculation disabled. Using default fee.`, addLog);
    printStep('register', chalk.yellow(`⚠ ${messages.feeWarning}`), this.language, addLog);
    const nameLength = name.length;
    let defaultFee;
    if (nameLength === 3) {
      defaultFee = this.w3.utils.toWei('1', 'ether');
    } else if (nameLength === 4) {
      defaultFee = this.w3.utils.toWei('0.3', 'ether');
    } else {
      defaultFee = this.w3.utils.toWei('0.1', 'ether');
    }
    printStep('register', chalk.cyan(messages.defaultFee(nameLength, this.w3.utils.fromWei(defaultFee, 'ether'))), this.language, addLog);
    return defaultFee;
  }

  async checkMonBalance(addLog) {
    const messages = translations[this.language];
    printStep('check', messages.monBalance('Checking...'), this.language, addLog);
    try {
      const balance = await this.w3.eth.getBalance(this.account.address);
      const balanceMon = this.w3.utils.fromWei(balance, 'ether');
      if (balanceMon < MIN_MON_BALANCE) {
        printStep('check', chalk.red(messages.insufficientMon(balanceMon)), this.language, addLog);
        return false;
      }
      printStep('check', chalk.green(`✔ ${messages.monBalance(balanceMon)}`), this.language, addLog);
      return true;
    } catch (e) {
      printStep('check', chalk.red(`✘ Error checking MON balance: ${e.message}`), this.language, addLog);
      return false;
    }
  }

  async isNameAvailable(name, addLog) {
    const messages = translations[this.language];
    printStep('check', messages.check(name), this.language, addLog);
    const signatureData = await this.getSignature(name, addLog);
    if (signatureData) {
      printStep('check', chalk.green(`✔ ${messages.available(name)}`), this.language, addLog);
      return true;
    }
    printStep('check', chalk.red(`✘ ${messages.unavailable(name)}`), this.language, addLog);
    return false;
  }

  async registerDomain(name, addLog) {
    const messages = translations[this.language];
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        if (!(await this.checkMonBalance(addLog))) {
          return false;
        }
        if (!(await this.isNameAvailable(name, addLog))) {
          return false;
        }
        const signatureData = await this.getSignature(name, addLog);
        if (!signatureData) {
          return false;
        }
        const fee = await this.calculateFee(name, addLog);
        printStep('register', messages.register(name), this.language, addLog);
        const registerData = [
          name,
          this.account.address,
          true,
          '0x0000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          '0x0000000000000000000000000000000000000000000000000000000000000000',
          signatureData.nonce,
          signatureData.deadline,
        ];
        const signature = signatureData.signature;
        safeLog(`[${this.accountIndex}] Register data: ${JSON.stringify(registerData)}`, addLog);
        const gasParams = await this.getGasParams(addLog);
        safeLog(`[${this.accountIndex}] Transaction params: fee=${this.w3.utils.fromWei(fee, 'ether')} MON, gasParams=${JSON.stringify(gasParams)}, registerData=${JSON.stringify(registerData)}`, addLog);
        const gasEstimate = await this.contract.methods
          .registerWithSignature(registerData, signature)
          .estimateGas({ from: this.account.address, value: fee });
        const gasWithBuffer = Math.floor(gasEstimate * 1.2);
        const transaction = {
          from: this.account.address,
          to: this.w3.utils.toChecksumAddress(NAD_CONTRACT_ADDRESS),
          data: this.contract.methods.registerWithSignature(registerData, signature).encodeABI(),
          value: this.w3.utils.toBN(fee),
          gas: gasWithBuffer,
          nonce: await this.w3.eth.getTransactionCount(this.account.address, 'pending'),
          chainId: 10143,
          type: '0x2',
          maxFeePerGas: this.w3.utils.toBN(gasParams.maxFeePerGas),
          maxPriorityFeePerGas: this.w3.utils.toBN(gasParams.maxPriorityFeePerGas),
        };
        safeLog(`[${this.accountIndex}] Final transaction: ${JSON.stringify(transaction)}`, addLog);
        const signedTx = await this.w3.eth.accounts.signTransaction(transaction, this.privateKey);
        const txHash = await this.w3.eth.sendSignedTransaction(signedTx.rawTransaction);
        if (txHash.status) {
          printStep(
            'register',
            chalk.green(`✔ ${messages.registerSuccess(name, txHash.transactionHash)}`),
            this.language,
            addLog
          );
          safeLog(`[${this.accountIndex}] Successfully registered ${name}. TX: ${EXPLORER_URL}${txHash.transactionHash}`, addLog);
          return true;
        } else {
          printStep(
            'register',
            chalk.red(`✘ ${messages.registerFail(name, txHash.transactionHash)}`),
            this.language,
            addLog
          );
          return false;
        }
      } catch (e) {
        if (e.message.includes('execution reverted')) {
          printStep('register', chalk.red(`✘ ${messages.registerFail(name, null)}: Transaction reverted by contract`), this.language, addLog);
          return false;
        }
        if (e.message.includes('NUMERIC_FAULT')) {
          printStep('register', chalk.red(`✘ ${messages.registerFail(name, null)}: Gas fee or nonce overflow detected`), this.language, addLog);
          return false;
        }
        await this._handleError('register_domain', e, addLog);
      }
    }
    printStep('register', chalk.red(`✘ ${messages.registerFail(name, null)} after ${ATTEMPTS} attempts`), this.language, addLog);
    return false;
  }

  async hasDomain(addLog) {
    const messages = translations[this.language];
    printStep('balance', messages.noDomain, this.language, addLog);
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        const balance = await this.nftContract.methods.balanceOf(this.account.address).call();
        if (balance > 0) {
          safeLog(`[${this.accountIndex}] Wallet owns ${balance} NAD domain(s)`, addLog);
          printStep('balance', chalk.green(`✔ ${messages.hasDomain(balance)}`), this.language, addLog);
          return true;
        }
        printStep('balance', chalk.yellow(`⚠ ${messages.noDomain}`), this.language, addLog);
        return false;
      } catch (e) {
        await this._handleError('has_domain', e, addLog);
      }
    }
    printStep('balance', chalk.red(`✘ Failed to check balance after ${ATTEMPTS} attempts`), this.language, addLog);
    return false;
  }

  async registerCustomDomain(customName, addLog, requestInput) {
    const messages = translations[this.language];
    const hasExistingDomain = await this.hasDomain(addLog);
    if (hasExistingDomain) {
      safeLog(messages.confirm, addLog);
      const choice = await requestInput(messages.confirm);
      if (choice.toLowerCase() !== 'y') {
        printStep('register', chalk.yellow(`⚠ ${messages.skip}`), this.language, addLog);
        return true;
      }
    }
    return await this.registerDomain(customName, addLog);
  }

  async registerRandomDomain(addLog, requestInput) {
    const messages = translations[this.language];
    const hasExistingDomain = await this.hasDomain(addLog);
    if (hasExistingDomain) {
      safeLog(messages.confirm, addLog);
      const choice = await requestInput(messages.confirm);
      if (choice.toLowerCase() !== 'y') {
        printStep('register', chalk.yellow(`⚠ ${messages.skip}`), this.language, addLog);
        return true;
      }
    }
    for (let retry = 0; retry < ATTEMPTS; retry++) {
      try {
        const name = this.generateRandomName();
        safeLog(`[${this.accountIndex}] Generated random domain name: ${name}`, addLog);
        printStep('register', chalk.cyan(`Random domain: ${name}`), this.language, addLog);
        if (await this.isNameAvailable(name, addLog)) {
          if (await this.registerDomain(name, addLog)) {
            return true;
          }
        } else {
          printStep('register', chalk.yellow(`⚠ ${messages.unavailable(name)}, trying again...`), this.language, addLog);
        }
      } catch (e) {
        await this._handleError('register_random_domain', e, addLog);
      }
    }
    printStep('register', chalk.red(`✘ Failed to register a random domain after ${ATTEMPTS} attempts`), this.language, addLog);
    return false;
  }

  async _handleError(action, error, addLog) {
    const pause = getRandomPause(PAUSE_BETWEEN_ACTIONS);
    let errorMsg = `Error in ${action}: ${error.message}`;
    if (error.message.includes('NUMERIC_FAULT')) {
      errorMsg = `Error in ${action}: Gas fee or nonce overflow detected. Check API response or transaction parameters.`;
    }
    safeLog(`[${this.accountIndex}] ${errorMsg}`, addLog);
    printStep(action, chalk.red(`${errorMsg}. Retrying in ${(pause / 1000).toFixed(2)}s`), this.language, addLog);
    await sleep(pause);
  }
}

// Main execution
module.exports = async (addLog, updatePanel, closeUI, requestInput) => {
  const w3 = new Web3(new Web3.providers.HttpProvider(RPC_URL));
  const lang = translations.en;

  // Log web3.js version
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
    const nad = new NadDomains(idx + 1, privateKey, w3);
    const accountMsg = `${lang.account} ${idx + 1}/${privateKeys.length} | ${nad.walletShort}`;
    safeLog(chalk.blue(`--- ${accountMsg} ---`), addLog);

    try {
      safeLog(chalk.cyan(lang.prompt), addLog);
      const customName = await requestInput(lang.prompt);
      if (!customName.trim()) {
        if (await nad.registerRandomDomain(addLog, requestInput)) {
          successCount++;
        }
      } else {
        if (await nad.registerCustomDomain(customName.trim(), addLog, requestInput)) {
          successCount++;
        }
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
