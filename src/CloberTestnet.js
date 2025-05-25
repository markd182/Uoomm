const fs = require('fs');
const { ethers } = require('ethers');
const axios = require('axios');

// Hardcoded configuration
const RPC_URL = "https://proud-tiniest-flower.monad-testnet.quiknode.pro/a4ebe00fca2e7bf01201f3b0f7fe2f0077c52a36";
const WMON_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const USDC_ADDRESS = "0xf817257fed379853cDe0fa4F97AB987181B1E5Ea";
const SMON_ADDRESS = "0xe1d2439b75fb9746E7Bc6cB777Ae10AA7f7ef9c5";
const DAK_ADDRESS = "0x0F0BDEbF0F83cD1EE3974779Bcb7315f9808c714";
const WMON_SWAP_ADDRESS = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const ROUTER_ADDRESS = "0xfD845859628946B317A78A9250DA251114FbD846";
const NETWORK_NAME = "CLOBER TESTNET";
const OPEN_OCEAN_API = "https://open-api.openocean.finance/v4/10143/swap";
const REFERRER = "0x331fa4a4f7b906491f37bdc8b042b894234e101f";
const DEBUG_MODE = false;

// Read private key from pvkey.txt
let PRIVATE_KEY;
try {
  PRIVATE_KEY = fs.readFileSync("pvkey.txt", "utf8").trim();
} catch (error) {
  throw new Error("Error reading pvkey.txt: " + error.message);
}

const ERC20ABI = [
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)"
];

const WMON_ABI = [
  "function deposit() payable",
  "function withdraw(uint256 wad)"
];

const CLOBER_ABI = [
  "function swap(address inToken, address outToken, uint256 inAmount, address recipient, bytes data) payable"
];

const randomAmountRanges = {
  "MON_WMON": { MON: { min: 0.1, max: 0.5 }, WMON: { min: 0.1, max: 0.5 } },
  "MON_USDC": { MON: { min: 0.1, max: 0.5 }, USDC: { min: 0.3, max: 1.5 } },
  "MON_sMON": { MON: { min: 0.1, max: 0.5 }, sMON: { min: 0.1, max: 0.5 } },
  "MON_DAK": { MON: { min: 0.1, max: 0.5 }, DAK: { min: 0.3, max: 1.0 } }
};

let walletInfo = {
  address: "",
  balanceMon: "0.00",
  balanceWmon: "0.00",
  balanceUsdc: "0.00",
  balanceSmon: "0.00",
  balanceDak: "0.00",
  totalVolumeUsd: "0.00",
  leaderboardRank: "N/A",
  network: NETWORK_NAME
};

let swapRunning = false;
let swapCancelled = false;
let globalWallet = null;
let provider = null;
let transactionQueue = Promise.resolve();
let transactionQueueList = [];
let transactionIdCounter = 0;
let nextNonce = null;
let lastSwapDirectionMonWmon = null;
let lastSwapDirectionMonUsdc = null;
let lastSwapDirectionMonSmon = null;
let lastSwapDirectionMonDak = null;

module.exports = async function(addLog, updatePanel, closeUI, requestInput, lang) {
  function getShortAddress(address) {
    return address ? address.slice(0, 6) + "..." + address.slice(-4) : "N/A";
  }

  function getShortHash(hash) {
    return hash && typeof hash === "string" && hash !== "0x" ? hash.slice(0, 6) + "..." + hash.slice(-4) : "Invalid Hash";
  }

  function log(message, type) {
    if (type === "debug" && !DEBUG_MODE) return;
    const timestamp = new Date().toLocaleTimeString();
    addLog(`[${timestamp}] ${message}`);
  }

  function getRandomDelay() {
    return Math.random() * (60000 - 30000) + 30000;
  }

  function getRandomNumber(min, max) {
    return Math.random() * (max - min) + min;
  }

  async function waitWithCancel(delay, type) {
    return Promise.race([
      new Promise(resolve => setTimeout(resolve, delay)),
      new Promise(resolve => {
        const interval = setInterval(() => {
          if (type === "swap" && swapCancelled) {
            clearInterval(interval);
            resolve();
          }
        }, 100);
      })
    ]);
  }

  async function fetchLeaderboardData(walletAddress) {
    try {
      const response = await axios.get(`https://alpha.clober.io/api/chains/10143/leaderboard/user-address/${walletAddress}`);
      if (response.status === 200 && response.data.my_rank) {
        walletInfo.totalVolumeUsd = parseFloat(response.data.my_rank.total_volume_usd).toFixed(2);
        walletInfo.leaderboardRank = response.data.my_rank.rank.toString();
      } else {
        throw new Error("Invalid leaderboard response");
      }
    } catch (error) {
      walletInfo.totalVolumeUsd = "0.00";
      walletInfo.leaderboardRank = "N/A";
      log(`Failed to fetch leaderboard data: ${error.message}`, "error");
    }
  }

  async function addTransactionToQueue(transactionFunction, description = "Transaction") {
    const transactionId = ++transactionIdCounter;
    transactionQueueList.push({
      id: transactionId,
      description,
      timestamp: new Date().toLocaleTimeString(),
      status: "queued"
    });
    log(`Transaction [${transactionId}] added to queue: ${description}`, "system");

    transactionQueue = transactionQueue.then(async () => {
      transactionQueueList.find(tx => tx.id === transactionId).status = "processing";
      try {
        if (nextNonce === null) {
          nextNonce = await provider.getTransactionCount(globalWallet.address, "pending");
          log(`Initial nonce: ${nextNonce}`, "debug");
        }
        const tx = await transactionFunction(nextNonce);
        const txHash = tx.hash;
        const receipt = await tx.wait();
        nextNonce++;
        if (receipt.status === 1) {
          transactionQueueList.find(tx => tx.id === transactionId).status = "completed";
          log(`Transaction [${transactionId}] completed. Hash: ${getShortHash(receipt.transactionHash || txHash)}`, "debug");
        } else {
          transactionQueueList.find(tx => tx.id === transactionId).status = "failed";
          log(`Transaction [${transactionId}] failed: Transaction reverted`, "error");
        }
        return { receipt, txHash, tx };
      } catch (error) {
        transactionQueueList.find(tx => tx.id === transactionId).status = "error";
        let errorMessage = error.message;
        if (error.code === "CALL_EXCEPTION") {
          errorMessage = `Transaction reverted: ${error.reason || "Unknown reason"}`;
        }
        log(`Transaction [${transactionId}] failed: ${errorMessage}`, "error");
        if (error.message.includes("nonce has already been used")) {
          nextNonce++;
          log(`Nonce incremented due to prior use. New nonce: ${nextNonce}`, "system");
        }
        return null;
      } finally {
        transactionQueueList = transactionQueueList.filter(tx => tx.id !== transactionId);
      }
    });
    return transactionQueue;
  }

  async function getTokenBalance(tokenAddress) {
    try {
      const contract = new ethers.Contract(tokenAddress, ERC20ABI, provider);
      const balance = await contract.balanceOf(globalWallet.address);
      const decimals = await contract.decimals();
      return ethers.utils.formatUnits(balance, decimals);
    } catch (error) {
      log(`Failed to fetch balance for token ${tokenAddress}: ${error.message}`, "error");
      return "0";
    }
  }

  async function updateWalletData() {
    try {
      provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
      globalWallet = wallet;
      walletInfo.address = wallet.address;

      const monBalance = await provider.getBalance(wallet.address);
      walletInfo.balanceMon = ethers.utils.formatEther(monBalance);
      walletInfo.balanceWmon = await getTokenBalance(WMON_ADDRESS);
      walletInfo.balanceUsdc = await getTokenBalance(USDC_ADDRESS);
      walletInfo.balanceSmon = await getTokenBalance(SMON_ADDRESS);
      walletInfo.balanceDak = await getTokenBalance(DAK_ADDRESS);
      await fetchLeaderboardData(wallet.address);
      log("Wallet data updated", "system");
      updatePanel(`
Wallet Address: ${getShortAddress(walletInfo.address)}
Network: ${walletInfo.network}
Balances:
  MON: ${Number(walletInfo.balanceMon).toFixed(4)}
  WMON: ${Number(walletInfo.balanceWmon).toFixed(4)}
  USDC: ${Number(walletInfo.balanceUsdc).toFixed(2)}
  sMON: ${Number(walletInfo.balanceSmon).toFixed(4)}
  DAK: ${Number(walletInfo.balanceDak).toFixed(4)}
Total Volume (USD): ${walletInfo.totalVolumeUsd}
Leaderboard Rank: ${walletInfo.leaderboardRank}
      `);
    } catch (error) {
      log(`Failed to fetch wallet data: ${error.message}`, "error");
    }
  }

  async function autoSwapMonWmon() {
    const direction = lastSwapDirectionMonWmon === "MON_TO_WMON" ? "WMON_TO_MON" : "MON_TO_WMON";
    lastSwapDirectionMonWmon = direction;

    const ranges = randomAmountRanges["MON_WMON"];
    const amount = direction === "MON_TO_WMON"
      ? getRandomNumber(ranges.MON.min, ranges.MON.max).toFixed(6)
      : getRandomNumber(ranges.WMON.min, ranges.WMON.max).toFixed(6);
    const swapContract = new ethers.Contract(WMON_SWAP_ADDRESS, WMON_ABI, globalWallet);
    const wmonContract = new ethers.Contract(WMON_ADDRESS, ERC20ABI, globalWallet);
    const decimals = await wmonContract.decimals();
    const amountWei = ethers.utils.parseUnits(amount, decimals);

    if (direction === "MON_TO_WMON") {
      const monBalance = await provider.getBalance(globalWallet.address);
      if (parseFloat(ethers.utils.formatEther(monBalance)) < parseFloat(amount)) {
        log(`Insufficient MON balance: ${ethers.utils.formatEther(monBalance)} < ${amount}`, "warning");
        return false;
      }

      log(`Swapping ${amount} MON to WMON`, "swap");

      let txParams = { value: amountWei, nonce: null };
      try {
        const gasLimit = await swapContract.estimateGas.deposit({ value: amountWei });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed for deposit: ${error.message}. Using default gas`, "debug");
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await swapContract.deposit(txParams);
        log(`Tx sent: ${amount} MON to WMON, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amount} MON to WMON`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amount} MON to WMON, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: MON to WMON. Transaction may have failed or is pending`, "error");
        return false;
      }
    } else {
      const wmonBalance = await getTokenBalance(WMON_ADDRESS);
      if (parseFloat(wmonBalance) < parseFloat(amount)) {
        log(`Insufficient WMON balance: ${wmonBalance} < ${amount}`, "warning");
        return false;
      }

      log(`Swapping ${amount} WMON to MON`, "swap");

      const allowance = await wmonContract.allowance(globalWallet.address, WMON_SWAP_ADDRESS);
      if (allowance.lt(amountWei)) {
        log(`Requesting approval for ${amount} WMON`, "swap");
        let approveTxParams = { nonce: null };
        try {
          const approveGasLimit = await wmonContract.estimateGas.approve(WMON_SWAP_ADDRESS, amountWei);
          approveTxParams.gasLimit = approveGasLimit.mul(120).div(100);
          log(`Gas estimate for approval: ${approveTxParams.gasLimit}`, "debug");
        } catch (error) {
          log(`Gas estimation failed for approval: ${error.message}. Using default gas`, "debug");
        }
        const approveTxFunction = async (nonce) => {
          approveTxParams.nonce = nonce;
          const tx = await wmonContract.approve(WMON_SWAP_ADDRESS, amountWei, approveTxParams);
          log(`Approval transaction sent`, "swap");
          return tx;
        };
        const result = await addTransactionToQueue(approveTxFunction, `Approve ${amount} WMON`);
        if (!result || !result.receipt || result.receipt.status !== 1) {
          log(`Approval failed for WMON. Cancelling swap`, "error");
          return false;
        }
        log(`Approval successful for ${amount} WMON`, "swap");
      }

      let txParams = { nonce: null };
      try {
        const gasLimit = await swapContract.estimateGas.withdraw(amountWei);
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed for withdraw: ${error.message}. Using default gas`, "debug");
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await swapContract.withdraw(amountWei, txParams);
        log(`Tx sent: ${amount} WMON to MON, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amount} WMON to MON`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amount} WMON to MON, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: WMON to MON. Transaction may have failed or is pending`, "error");
        return false;
      }
    }
  }

  async function autoSwapMonUsdc() {
    const direction = lastSwapDirectionMonUsdc === "MON_TO_USDC" ? "USDC_TO_MON" : "MON_TO_USDC";
    lastSwapDirectionMonUsdc = direction;

    const ranges = randomAmountRanges["MON_USDC"];
    const usdcContract = new ethers.Contract(USDC_ADDRESS, ERC20ABI, globalWallet);
    const usdcDecimals = await usdcContract.decimals();
    const swapInterface = new ethers.utils.Interface(CLOBER_ABI);

    if (direction === "MON_TO_USDC") {
      const amountMon = getRandomNumber(ranges.MON.min, ranges.MON.max).toFixed(6);
      const monBalance = await provider.getBalance(globalWallet.address);
      if (parseFloat(ethers.utils.formatEther(monBalance)) < parseFloat(amountMon)) {
        log(`Insufficient MON balance: ${ethers.utils.formatEther(monBalance)} < ${amountMon}`, "warning");
        return false;
      }

      log(`Swapping ${amountMon} MON to USDC`, "swap");

      let swapData;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await axios.get(OPEN_OCEAN_API, {
          params: {
            inTokenAddress: "0x0000000000000000000000000000000000000000",
            outTokenAddress: USDC_ADDRESS,
            amount: amountMon,
            gasPrice: "52000000000",
            slippage: 1,
            account: globalWallet.address,
            referrer: REFERRER
          }
        });
        if (response.data.code !== 200) {
          log(`Failed to fetch swap data from API: ${response.data.message || "Unknown error"}`, "error");
          return false;
        }
        swapData = response.data.data;
        log(`API Response: Getting ${ethers.utils.formatUnits(swapData.outAmount, usdcDecimals)} USDC for ${amountMon} MON`, "debug");
      } catch (error) {
        log(`Failed to call OpenOcean API: ${error.message}`, "error");
        return false;
      }

      const inToken = "0x0000000000000000000000000000000000000000";
      const outToken = USDC_ADDRESS;
      const inAmount = ethers.utils.parseEther(amountMon);
      const recipient = swapData.to;
      const data = swapData.data;

      const callData = swapInterface.encodeFunctionData("swap", [inToken, outToken, inAmount, recipient, data]);

      let txParams = {
        to: ROUTER_ADDRESS,
        data: callData,
        value: inAmount,
        nonce: null
      };

      try {
        const gasLimit = await provider.estimateGas({ ...txParams, from: globalWallet.address });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed: ${error.message}. Using default gas 52000`, "debug");
        txParams.gasLimit = 52000;
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await globalWallet.sendTransaction(txParams);
        log(`Tx sent: ${amountMon} MON to ${ethers.utils.formatUnits(swapData.outAmount, usdcDecimals)} USDC, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amountMon} MON to USDC`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amountMon} MON to ${ethers.utils.formatUnits(swapData.outAmount, usdcDecimals)} USDC, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: MON to USDC. Transaction may have failed or is pending`, "error");
        return false;
      }
    } else {
      const amountUsdc = getRandomNumber(ranges.USDC.min, ranges.USDC.max).toFixed(6);
      const usdcBalance = await getTokenBalance(USDC_ADDRESS);
      if (parseFloat(usdcBalance) < parseFloat(amountUsdc)) {
        log(`Insufficient USDC balance: ${usdcBalance} < ${amountUsdc}`, "warning");
        return false;
      }

      log(`Swapping ${amountUsdc} USDC to MON`, "swap");

      let swapData;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await axios.get(OPEN_OCEAN_API, {
          params: {
            inTokenAddress: USDC_ADDRESS,
            outTokenAddress: "0x0000000000000000000000000000000000000000",
            amount: amountUsdc,
            gasPrice: "52000000000",
            slippage: 1,
            account: globalWallet.address,
            referrer: REFERRER
          }
        });
        if (response.data.code !== 200) {
          log(`Failed to fetch swap data from API: ${response.data.message || "Unknown error"}`, "error");
          return false;
        }
        swapData = response.data.data;
        log(`API Response: Getting ${ethers.utils.formatEther(swapData.outAmount)} MON for ${amountUsdc} USDC`, "debug");
      } catch (error) {
        log(`Failed to call OpenOcean API: ${error.message}`, "error");
        return false;
      }

      const inToken = USDC_ADDRESS;
      const outToken = "0x0000000000000000000000000000000000000000";
      const inAmount = ethers.utils.parseUnits(amountUsdc, usdcDecimals);
      const recipient = swapData.to;
      const data = swapData.data;

      const allowance = await usdcContract.allowance(globalWallet.address, ROUTER_ADDRESS);
      if (allowance.lt(inAmount)) {
        log(`Requesting approval for ${amountUsdc} USDC`, "swap");
        let approveTxParams = { nonce: null };
        try {
          const approveGasLimit = await usdcContract.estimateGas.approve(ROUTER_ADDRESS, inAmount);
          approveTxParams.gasLimit = approveGasLimit.mul(120).div(100);
          log(`Gas estimate for approval: ${approveTxParams.gasLimit}`, "debug");
        } catch (error) {
          log(`Gas estimation failed: ${error.message}. Using default gas 100000`, "debug");
          approveTxParams.gasLimit = 100000;
        }
        const approveTxFunction = async (nonce) => {
          approveTxParams.nonce = nonce;
          const tx = await usdcContract.approve(ROUTER_ADDRESS, inAmount, approveTxParams);
          log(`Approval transaction sent`, "swap");
          return tx;
        };
        const result = await addTransactionToQueue(approveTxFunction, `Approve ${amountUsdc} USDC`);
        if (!result || !result.receipt || result.receipt.status !== 1) {
          log(`Approval failed for USDC. Cancelling swap`, "error");
          return false;
        }
        log(`Approval successful for ${amountUsdc} USDC`, "swap");
      }

      const callData = swapInterface.encodeFunctionData("swap", [inToken, outToken, inAmount, recipient, data]);

      let txParams = {
        to: ROUTER_ADDRESS,
        data: callData,
        value: ethers.utils.parseUnits(swapData.value || "0", "wei"),
        nonce: null
      };

      try {
        const gasLimit = await provider.estimateGas({ ...txParams, from: globalWallet.address });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed: ${error.message}. Using default gas 50000`, "debug");
        txParams.gasLimit = 50000;
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await globalWallet.sendTransaction(txParams);
        log(`Tx sent: ${amountUsdc} USDC to ${ethers.utils.formatEther(swapData.outAmount)} MON, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amountUsdc} USDC to MON`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amountUsdc} USDC to ${ethers.utils.formatEther(swapData.outAmount)} MON, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: USDC to MON. Transaction may have failed or is pending`, "error");
        return false;
      }
    }
  }

  async function autoSwapMonSmon() {
    const direction = lastSwapDirectionMonSmon === "MON_TO_sMON" ? "sMON_TO_MON" : "MON_TO_sMON";
    lastSwapDirectionMonSmon = direction;

    const ranges = randomAmountRanges["MON_sMON"];
    const smonContract = new ethers.Contract(SMON_ADDRESS, ERC20ABI, globalWallet);
    const smonDecimals = await smonContract.decimals();
    const swapInterface = new ethers.utils.Interface(CLOBER_ABI);

    if (direction === "MON_TO_sMON") {
      const amountMon = getRandomNumber(ranges.MON.min, ranges.MON.max).toFixed(6);
      const monBalance = await provider.getBalance(globalWallet.address);
      if (parseFloat(ethers.utils.formatEther(monBalance)) < parseFloat(amountMon)) {
        log(`Insufficient MON balance: ${ethers.utils.formatEther(monBalance)} < ${amountMon}`, "warning");
        return false;
      }

      log(`Swapping ${amountMon} MON to sMON`, "swap");

      let swapData;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await axios.get(OPEN_OCEAN_API, {
          params: {
            inTokenAddress: "0x0000000000000000000000000000000000000000",
            outTokenAddress: SMON_ADDRESS,
            amount: amountMon,
            gasPrice: "52000000000",
            slippage: 1,
            account: globalWallet.address,
            referrer: REFERRER
          }
        });
        if (response.data.code !== 200) {
          log(`Failed to fetch swap data from API: ${response.data.message || "Unknown error"}`, "error");
          return false;
        }
        swapData = response.data.data;
        log(`API Response: Getting ${ethers.utils.formatUnits(swapData.outAmount, smonDecimals)} sMON for ${amountMon} MON`, "debug");
      } catch (error) {
        log(`Failed to call OpenOcean API: ${error.message}`, "error");
        return false;
      }

      const inToken = "0x0000000000000000000000000000000000000000";
      const outToken = SMON_ADDRESS;
      const inAmount = ethers.utils.parseEther(amountMon);
      const recipient = swapData.to;
      const data = swapData.data;

      const callData = swapInterface.encodeFunctionData("swap", [inToken, outToken, inAmount, recipient, data]);

      let txParams = {
        to: ROUTER_ADDRESS,
        data: callData,
        value: inAmount,
        nonce: null
      };

      try {
        const gasLimit = await provider.estimateGas({ ...txParams, from: globalWallet.address });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed: ${error.message}. Using default gas 50000`, "debug");
        txParams.gasLimit = 50000;
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await globalWallet.sendTransaction(txParams);
        log(`Tx sent: ${amountMon} MON to ${ethers.utils.formatUnits(swapData.outAmount, smonDecimals)} sMON, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amountMon} MON to sMON`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amountMon} MON to ${ethers.utils.formatUnits(swapData.outAmount, smonDecimals)} sMON, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: MON to sMON. Transaction may have failed or is pending`, "error");
        return false;
      }
    } else {
      const amountSmon = getRandomNumber(ranges.sMON.min, ranges.sMON.max).toFixed(6);
      const smonBalance = await getTokenBalance(SMON_ADDRESS);
      if (parseFloat(smonBalance) < parseFloat(amountSmon)) {
        log(`Insufficient sMON balance: ${smonBalance} < ${amountSmon}`, "warning");
        return false;
      }

      log(`Swapping ${amountSmon} sMON to MON`, "swap");

      let swapData;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await axios.get(OPEN_OCEAN_API, {
          params: {
            inTokenAddress: SMON_ADDRESS,
            outTokenAddress: "0x0000000000000000000000000000000000000000",
            amount: amountSmon,
            gasPrice: "52000000000",
            slippage: 1,
            account: globalWallet.address,
            referrer: REFERRER
          }
        });
        if (response.data.code !== 200) {
          log(`Failed to fetch swap data from API: ${response.data.message || "Unknown error"}`, "error");
          return false;
        }
        swapData = response.data.data;
        log(`API Response: Getting ${ethers.utils.formatEther(swapData.outAmount)} MON for ${amountSmon} sMON`, "debug");
      } catch (error) {
        log(`Failed to call OpenOcean API: ${error.message}`, "error");
        return false;
      }

      const inToken = SMON_ADDRESS;
      const outToken = "0x0000000000000000000000000000000000000000";
      const inAmount = ethers.utils.parseUnits(amountSmon, smonDecimals);
      const recipient = swapData.to;
      const data = swapData.data;

      const allowance = await smonContract.allowance(globalWallet.address, ROUTER_ADDRESS);
      if (allowance.lt(inAmount)) {
        log(`Requesting approval for ${amountSmon} sMON`, "swap");
        let approveTxParams = { nonce: null };
        try {
          const approveGasLimit = await smonContract.estimateGas.approve(ROUTER_ADDRESS, inAmount);
          approveTxParams.gasLimit = approveGasLimit.mul(120).div(100);
          log(`Gas estimate for approval: ${approveTxParams.gasLimit}`, "debug");
        } catch (error) {
          log(`Gas estimation failed: ${error.message}. Using default gas 100000`, "debug");
          approveTxParams.gasLimit = 100000;
        }
        const approveTxFunction = async (nonce) => {
          approveTxParams.nonce = nonce;
          const tx = await smonContract.approve(ROUTER_ADDRESS, inAmount, approveTxParams);
          log(`Approval transaction sent`, "swap");
          return tx;
        };
        const result = await addTransactionToQueue(approveTxFunction, `Approve ${amountSmon} sMON`);
        if (!result || !result.receipt || result.receipt.status !== 1) {
          log(`Approval failed for sMON. Cancelling swap`, "error");
          return false;
        }
        log(`Approval successful for ${amountSmon} sMON`, "swap");
      }

      const callData = swapInterface.encodeFunctionData("swap", [inToken, outToken, inAmount, recipient, data]);

      let txParams = {
        to: ROUTER_ADDRESS,
        data: callData,
        value: ethers.utils.parseUnits(swapData.value || "0", "wei"),
        nonce: null
      };

      try {
        const gasLimit = await provider.estimateGas({ ...txParams, from: globalWallet.address });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed: ${error.message}. Using default gas 50000`, "debug");
        txParams.gasLimit = 50000;
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await globalWallet.sendTransaction(txParams);
        log(`Tx sent: ${amountSmon} sMON to ${ethers.utils.formatEther(swapData.outAmount)} MON, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amountSmon} sMON to MON`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amountSmon} sMON to ${ethers.utils.formatEther(swapData.outAmount)} MON, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: sMON to MON. Transaction may have failed or is pending`, "error");
        return false;
      }
    }
  }

  async function autoSwapMonDak() {
    const direction = lastSwapDirectionMonDak === "MON_TO_DAK" ? "DAK_TO_MON" : "MON_TO_DAK";
    lastSwapDirectionMonDak = direction;

    const ranges = randomAmountRanges["MON_DAK"];
    const dakContract = new ethers.Contract(DAK_ADDRESS, ERC20ABI, globalWallet);
    const dakDecimals = await dakContract.decimals();
    const swapInterface = new ethers.utils.Interface(CLOBER_ABI);

    if (direction === "MON_TO_DAK") {
      const amountMon = getRandomNumber(ranges.MON.min, ranges.MON.max).toFixed(6);
      const monBalance = await provider.getBalance(globalWallet.address);
      if (parseFloat(ethers.utils.formatEther(monBalance)) < parseFloat(amountMon)) {
        log(`Insufficient MON balance: ${ethers.utils.formatEther(monBalance)} < ${amountMon}`, "warning");
        return false;
      }

      log(`Swapping ${amountMon} MON to DAK`, "swap");

      let swapData;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await axios.get(OPEN_OCEAN_API, {
          params: {
            inTokenAddress: "0x0000000000000000000000000000000000000000",
            outTokenAddress: DAK_ADDRESS,
            amount: amountMon,
            gasPrice: "52000000000",
            slippage: 1,
            account: globalWallet.address,
            referrer: REFERRER
          }
        });
        if (response.data.code !== 200) {
          log(`Failed to fetch swap data from API: ${response.data.message || "Unknown error"}`, "error");
          return false;
        }
        swapData = response.data.data;
        log(`API Response: Getting ${ethers.utils.formatUnits(swapData.outAmount, dakDecimals)} DAK for ${amountMon} MON`, "debug");
      } catch (error) {
        log(`Failed to call OpenOcean API: ${error.message}`, "error");
        return false;
      }

      const inToken = "0x0000000000000000000000000000000000000000";
      const outToken = DAK_ADDRESS;
      const inAmount = ethers.utils.parseEther(amountMon);
      const recipient = swapData.to;
      const data = swapData.data;

      const callData = swapInterface.encodeFunctionData("swap", [inToken, outToken, inAmount, recipient, data]);

      let txParams = {
        to: ROUTER_ADDRESS,
        data: callData,
        value: inAmount,
        nonce: null
      };

      try {
        const gasLimit = await provider.estimateGas({ ...txParams, from: globalWallet.address });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed: ${error.message}. Using default gas 50000`, "debug");
        txParams.gasLimit = 50000;
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await globalWallet.sendTransaction(txParams);
        log(`Tx sent: ${amountMon} MON to ${ethers.utils.formatUnits(swapData.outAmount, dakDecimals)} DAK, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amountMon} MON to DAK`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amountMon} MON to ${ethers.utils.formatUnits(swapData.outAmount, dakDecimals)} DAK, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: MON to DAK. Transaction may have failed or is pending`, "error");
        return false;
      }
    } else {
      const amountDak = getRandomNumber(ranges.DAK.min, ranges.DAK.max).toFixed(6);
      const dakBalance = await getTokenBalance(DAK_ADDRESS);
      if (parseFloat(dakBalance) < parseFloat(amountDak)) {
        log(`Insufficient DAK balance: ${dakBalance} < ${amountDak}`, "warning");
        return false;
      }

      log(`Swapping ${amountDak} DAK to MON`, "swap");

      let swapData;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const response = await axios.get(OPEN_OCEAN_API, {
          params: {
            inTokenAddress: DAK_ADDRESS,
            outTokenAddress: "0x0000000000000000000000000000000000000000",
            amount: amountDak,
            gasPrice: "52000000000",
            slippage: 1,
            account: globalWallet.address,
            referrer: REFERRER
          }
        });
        if (response.data.code !== 200) {
          log(`Failed to fetch swap data from API: ${response.data.message || "Unknown error"}`, "error");
          return false;
        }
        swapData = response.data.data;
        log(`API Response: Getting ${ethers.utils.formatEther(swapData.outAmount)} MON for ${amountDak} DAK`, "debug");
      } catch (error) {
        log(`Failed to call OpenOcean API: ${error.message}`, "error");
        return false;
      }

      const inToken = DAK_ADDRESS;
      const outToken = "0x0000000000000000000000000000000000000000";
      const inAmount = ethers.utils.parseUnits(amountDak, dakDecimals);
      const recipient = swapData.to;
      const data = swapData.data;

      const allowance = await dakContract.allowance(globalWallet.address, ROUTER_ADDRESS);
      if (allowance.lt(inAmount)) {
        log(`Requesting approval for ${amountDak} DAK`, "swap");
        let approveTxParams = { nonce: null };
        try {
          const approveGasLimit = await dakContract.estimateGas.approve(ROUTER_ADDRESS, inAmount);
          approveTxParams.gasLimit = approveGasLimit.mul(120).div(100);
          log(`Gas estimate for approval: ${approveTxParams.gasLimit}`, "debug");
        } catch (error) {
          log(`Gas estimation failed: ${error.message}. Using default gas 100000`, "debug");
          approveTxParams.gasLimit = 100000;
        }
        const approveTxFunction = async (nonce) => {
          approveTxParams.nonce = nonce;
          const tx = await dakContract.approve(ROUTER_ADDRESS, inAmount, approveTxParams);
          log(`Approval transaction sent`, "swap");
          return tx;
        };
        const result = await addTransactionToQueue(approveTxFunction, `Approve ${amountDak} DAK`);
        if (!result || !result.receipt || result.receipt.status !== 1) {
          log(`Approval failed for DAK. Cancelling swap`, "error");
          return false;
        }
        log(`Approval successful for ${amountDak} DAK`, "swap");
      }

      const callData = swapInterface.encodeFunctionData("swap", [inToken, outToken, inAmount, recipient, data]);

      let txParams = {
        to: ROUTER_ADDRESS,
        data: callData,
        value: ethers.utils.parseUnits(swapData.value || "0", "wei"),
        nonce: null
      };

      try {
        const gasLimit = await provider.estimateGas({ ...txParams, from: globalWallet.address });
        txParams.gasLimit = gasLimit.mul(120).div(100);
        log(`Gas estimate: ${txParams.gasLimit}`, "debug");
      } catch (error) {
        log(`Gas estimation failed: ${error.message}. Using default gas 50000`, "debug");
        txParams.gasLimit = 50000;
      }

      const swapTxFunction = async (nonce) => {
        txParams.nonce = nonce;
        const tx = await globalWallet.sendTransaction(txParams);
        log(`Tx sent: ${amountDak} DAK to ${ethers.utils.formatEther(swapData.outAmount)} MON, Hash: ${getShortHash(tx.hash)}`, "swap");
        return tx;
      };

      const result = await addTransactionToQueue(swapTxFunction, `Swap ${amountDak} DAK to MON`);

      if (result && result.receipt && result.receipt.status === 1) {
        log(`Swap successful: ${amountDak} DAK to ${ethers.utils.formatEther(swapData.outAmount)} MON, Hash: ${getShortHash(result.receipt.transactionHash || result.txHash)}`, "success");
        await updateWalletData();
        return true;
      } else {
        log(`Swap failed: DAK to MON. Transaction may have failed or is pending`, "error");
        return false;
      }
    }
  }

  async function runAutoSwapMonWmon() {
    if (swapRunning) {
      log("Swap: A swap transaction is already running", "warning");
      return;
    }
    const input = await requestInput("Enter number of swaps for MON & WMON", "number", "0");
    if (!input) {
      log("Swap: Input cancelled", "error");
      return;
    }
    const loopCount = parseInt(input);
    if (isNaN(loopCount) || loopCount <= 0) {
      log("Swap: Input must be a positive number", "error");
      return;
    }
    log(`Swap: Starting ${loopCount} iterations for MON & WMON`, "swap");

    swapRunning = true;
    swapCancelled = false;

    for (let i = 1; i <= loopCount; i++) {
      if (swapCancelled) {
        log(`Swap: Stopped at cycle ${i} for MON & WMON`, "swap");
        break;
      }
      log(`Starting swap ${i}: Direction ${lastSwapDirectionMonWmon === "MON_TO_WMON" ? "WMON_TO_MON" : "MON_TO_WMON"}`, "swap");
      const success = await autoSwapMonWmon();
      if (i < loopCount && success) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        log(`Swap ${i} completed. Waiting ${minutes}m ${seconds}s`, "swap");
        await waitWithCancel(delayTime, "swap");
        if (swapCancelled) {
          log("Swap: Stopped during wait period", "swap");
          break;
        }
      }
    }
    swapRunning = false;
    log("Swap: Completed MON & WMON swaps", "swap");
  }

  async function runAutoSwapMonUsdc() {
    if (swapRunning) {
      log("Swap: A swap transaction is already running", "warning");
      return;
    }
    const input = await requestInput("Enter number of swaps for MON & USDC", "number", "0");
    if (!input) {
      log("Swap: Input cancelled", "error");
      return;
    }
    const loopCount = parseInt(input);
    if (isNaN(loopCount) || loopCount <= 0) {
      log("Swap: Input must be a positive number", "error");
      return;
    }
    log(`Swap: Starting ${loopCount} iterations for MON & USDC`, "swap");

    swapRunning = true;
    swapCancelled = false;

    for (let i = 1; i <= loopCount; i++) {
      if (swapCancelled) {
        log(`Swap: Stopped at cycle ${i} for MON & USDC`, "swap");
        break;
      }
      log(`Starting swap ${i}: Direction ${lastSwapDirectionMonUsdc === "MON_TO_USDC" ? "USDC_TO_MON" : "MON_TO_USDC"}`, "swap");
      const success = await autoSwapMonUsdc();
      if (i < loopCount && success) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        log(`Swap ${i} completed. Waiting ${minutes}m ${seconds}s`, "swap");
        await waitWithCancel(delayTime, "swap");
        if (swapCancelled) {
          log("Swap: Stopped during wait period", "swap");
          break;
        }
      }
    }
    swapRunning = false;
    log("Swap: Completed MON & USDC swaps", "swap");
  }

  async function runAutoSwapMonSmon() {
    if (swapRunning) {
      log("Swap: A swap transaction is already running", "warning");
      return;
    }
    const input = await requestInput("Enter number of swaps for MON & sMON", "number", "0");
    if (!input) {
      log("Swap: Input cancelled", "error");
      return;
    }
    const loopCount = parseInt(input);
    if (isNaN(loopCount) || loopCount <= 0) {
      log("Swap: Input must be a positive number", "error");
      return;
    }
    log(`Swap: Starting ${loopCount} iterations for MON & sMON`, "swap");

    swapRunning = true;
    swapCancelled = false;

    for (let i = 1; i <= loopCount; i++) {
      if (swapCancelled) {
        log(`Swap: Stopped at cycle ${i} for MON & sMON`, "swap");
        break;
      }
      log(`Starting swap ${i}: Direction ${lastSwapDirectionMonSmon === "MON_TO_sMON" ? "sMON_TO_MON" : "MON_TO_sMON"}`, "swap");
      const success = await autoSwapMonSmon();
      if (i < loopCount && success) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        log(`Swap ${i} completed. Waiting ${minutes}m ${seconds}s`, "swap");
        await waitWithCancel(delayTime, "swap");
        if (swapCancelled) {
          log("Swap: Stopped during wait period", "swap");
          break;
        }
      }
    }
    swapRunning = false;
    log("Swap: Completed MON & sMON swaps", "swap");
  }

  async function runAutoSwapMonDak() {
    if (swapRunning) {
      log("Swap: A swap transaction is already running", "warning");
      return;
    }
    const input = await requestInput("Enter number of swaps for MON & DAK", "number", "0");
    if (!input) {
      log("Swap: Input cancelled", "error");
      return;
    }
    const loopCount = parseInt(input);
    if (isNaN(loopCount) || loopCount <= 0) {
      log("Swap: Input must be a positive number", "error");
      return;
    }
    log(`Swap: Starting ${loopCount} iterations for MON & DAK`, "swap");

    swapRunning = true;
    swapCancelled = false;

    for (let i = 1; i <= loopCount; i++) {
      if (swapCancelled) {
        log(`Swap: Stopped at cycle ${i} for MON & DAK`, "swap");
        break;
      }
      log(`Starting swap ${i}: Direction ${lastSwapDirectionMonDak === "MON_TO_DAK" ? "DAK_TO_MON" : "MON_TO_DAK"}`, "swap");
      const success = await autoSwapMonDak();
      if (i < loopCount && success) {
        const delayTime = getRandomDelay();
        const minutes = Math.floor(delayTime / 60000);
        const seconds = Math.floor((delayTime % 60000) / 1000);
        log(`Swap ${i} completed. Waiting ${minutes}m ${seconds}s`, "swap");
        await waitWithCancel(delayTime, "swap");
        if (swapCancelled) {
          log("Swap: Stopped during wait period", "swap");
          break;
        }
      }
    }
    swapRunning = false;
    log("Swap: Completed MON & DAK swaps", "swap");
  }

  async function changeRandomAmount(pair) {
    const pairKey = pair.replace(" & ", "_");
    const token2 = pair.split(" & ")[1];
    const inputMon = await requestInput(`Enter random amount range for MON in ${pair} (format: min,max, e.g., 0.1,0.5)`, "text");
    if (!inputMon) {
      log(`Change Random Amount: Input for MON in ${pair} cancelled`, "error");
      return;
    }
    const [minMon, maxMon] = inputMon.split(",").map(v => parseFloat(v.trim()));
    if (isNaN(minMon) || isNaN(maxMon) || minMon <= 0 || maxMon <= minMon) {
      log(`Change Random Amount: Invalid input for MON in ${pair}. Use format min,max (e.g., 0.1,0.5) with min > 0 and max > min`, "error");
      return;
    }

    const inputToken2 = await requestInput(`Enter random amount range for ${token2} in ${pair} (format: min,max, e.g., 0.1,0.5)`, "text");
    if (!inputToken2) {
      log(`Change Random Amount: Input for ${token2} in ${pair} cancelled`, "error");
      return;
    }
    const [minToken2, maxToken2] = inputToken2.split(",").map(v => parseFloat(v.trim()));
    if (isNaN(minToken2) || isNaN(maxToken2) || minToken2 <= 0 || maxToken2 <= minToken2) {
      log(`Change Random Amount: Invalid input for ${token2} in ${pair}. Use format min,max (e.g., 0.1,0.5) with min > 0 and max > min`, "error");
      return;
    }

    randomAmountRanges[pairKey] = {
      MON: { min: minMon, max: maxMon },
      [token2]: { min: minToken2, max: maxToken2 }
    };
    log(`Change Random Amount: Updated ${pair} to MON: ${minMon}-${maxMon}, ${token2}: ${minToken2}-${maxToken2}`, "success");
  }

  async function changeRandomAmountMenu() {
    while (true) {
      updatePanel(`
Change Random Amount Menu:
1. MON & WMON
2. MON & USDC
3. MON & sMON
4. MON & DAK
5. Back to Main Menu
      `);
      const choice = await requestInput("Select an option (1-5)", "number", "5");
      if (choice === 1) {
        await changeRandomAmount("MON & WMON");
      } else if (choice === 2) {
        await changeRandomAmount("MON & USDC");
      } else if (choice === 3) {
        await changeRandomAmount("MON & sMON");
      } else if (choice === 4) {
        await changeRandomAmount("MON & DAK");
      } else if (choice === 5) {
        break;
      } else {
        log("Invalid option. Please select 1-5", "error");
      }
    }
  }

  async function mainMenu() {
    await updateWalletData();
    while (true) {
      updatePanel(`
Main Menu:
${swapRunning ? "1. Stop Transaction" : "1. Clober Swap"}
${swapRunning ? "2. Show Balances" : "2. Show Balances"}
${swapRunning ? "3. Exit" : "3. Exit"}
      `);
      const choice = await requestInput(`Select an option (${swapRunning ? "1-3" : "1-3"})`, "number", "3");

      if (swapRunning && choice === 1) {
        swapCancelled = true;
        log("Stop Transaction: Swap transactions will be stopped", "system");
      } else if (choice === (swapRunning ? 1 : 1)) {
        while (true) {
          updatePanel(`
Clober Swap Menu:
${swapRunning ? "1. Stop Transaction" : "1. Swap MON & WMON"}
${swapRunning ? "2. Swap MON & WMON" : "2. Swap MON & USDC"}
${swapRunning ? "3. Swap MON & USDC" : "3. Swap MON & sMON"}
${swapRunning ? "4. Swap MON & sMON" : "4. Swap MON & DAK"}
${swapRunning ? "5. Swap MON & DAK" : "5. Change Random Amount"}
${swapRunning ? "6. Change Random Amount" : "6. Back to Main Menu"}
${swapRunning ? "7. Back to Main Menu" : ""}
          `);
          const swapChoice = await requestInput(`Select an option (${swapRunning ? "1-7" : "1-6"})`, "number", swapRunning ? "7" : "6");

          if (swapRunning && swapChoice === 1) {
            swapCancelled = true;
            log("Swap: Stop command received", "swap");
          } else if (swapChoice === (swapRunning ? 2 : 1)) {
            await runAutoSwapMonWmon();
          } else if (swapChoice === (swapRunning ? 3 : 2)) {
            await runAutoSwapMonUsdc();
          } else if (swapChoice === (swapRunning ? 4 : 3)) {
            await runAutoSwapMonSmon();
          } else if (swapChoice === (swapRunning ? 5 : 4)) {
            await runAutoSwapMonDak();
          } else if (swapChoice === (swapRunning ? 6 : 5)) {
            await changeRandomAmountMenu();
          } else if (swapChoice === (swapRunning ? 7 : 6)) {
            break;
          } else {
            log("Invalid option. Please select a valid option", "error");
          }
        }
      } else if (choice === (swapRunning ? 2 : 2)) {
        await updateWalletData();
      } else if (choice === (swapRunning ? 3 : 3)) {
        log("Exiting program", "system");
        closeUI();
      } else {
        log("Invalid option. Please select a valid option", "error");
      }
    }
  }

  try {
    await mainMenu();
  } catch (error) {
    log(`Error in main menu: ${error.message}`, "error");
    closeUI();
  }
};
