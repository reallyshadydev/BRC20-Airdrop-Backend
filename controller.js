import bitcoin from "bitcoinjs-lib";
import randomstring from 'randomstring';
import axios from "axios";
import fetch from "node-fetch";
import { Request } from "node-fetch";
import cron from "node-cron";
import { createSendBTC, createSendOrd } from '@unisat/ord-utils';
import { spawn } from 'child_process';
import { LocalWallet } from "./LocalWallet.js";
import DogeAirdropJob from "./modelDogeAirdrop.js";
import {
    OPENAPI_URL,
    testVersion,
    OPENAPI_UNISAT_URL,
    BLOCK_CYPHER_URL,
    OPENAPI_UNISAT_TOKEN,
    MEMPOOL_API,
    adminAddress,
    MAGIC_EDEN_TOKEN
} from "./config.js";
import InscribeSchema from "./model.js";
import TxSchema from "./modelTransfer.js";

const key = process.env.PRIVATE_KEY;
const feeRate = 10;

//const network = bitcoin.networks.bitcoin;
const network = bitcoin.networks.testnet;

const wallet = new LocalWallet(
    key,
    testVersion ? 1 : 0
);
const tokenTicker = process.env.TICKER;

const delay = ms => new Promise(res => setTimeout(res, ms));

export async function checkWallets(request, response) {
    try {
        const { ordinalAddress } = request.body;
        //const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt, totalBitmapCnt, totalFrogCnt, totalPunkCnt } = await getAvailableInscriptionNumber(ordinalAddress);
        const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt, totalBitmapCnt, totalFrogCnt, totalPunkCnt } = await getAvailableInscriptionNumber("bc1qlke80wu2w8ev3p66s9uqwdqrtmty2g4wg6u7ax");

        //const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt, totalBitmapCnt, totalFrogCnt, totalPunkCnt } = await getAvailableInscriptionNumber("bc1pxpcnla44dh5dg3h30wdt5wsa085ad48h3g5nxjqu96edh6780pjsns8s34");

        return response.status(200).send({ array: availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt, totalBitmapCnt, totalFrogCnt, totalPunkCnt });
    } catch (error) {
        console.log("Watch Wallet ================>", error);
        return response.status(400).send({ error: error });
    }
}

export async function checkInscribe(request, response) {
    try {
        const { inscribeId } = request.body;
        const inscribeSchema = await InscribeSchema.findOne({ arrayNumber: 1 });
        const existArray = inscribeSchema.inscribes;
        if (existArray.includes(inscribeId + "")) return response.status(200).send({ possible: false, msg: "Already Claimed" });
        else return response.status(200).send({ possible: true, msg: "Claim Possible" });
    } catch (error) {
        console.log("Check Inscribe ================>", error);
        return response.status(400).send({ error: error });
    }
}

export async function dogeAirdrop(request, response) {
    try {
        const { fromAddress, ticker, amount, recipients, op = 'transfer', repeat = 1 } = request.body;
        if (!fromAddress || !ticker || !amount || !Array.isArray(recipients) || recipients.length === 0) {
            return response.status(400).send({ error: 'fromAddress, ticker, amount, recipients[] required' });
        }
        if (recipients.length > 5000) {
            return response.status(400).send({ error: 'Max 5000 recipients per job' });
        }
        const job = new DogeAirdropJob({
            fromAddress,
            ticker,
            amount: String(amount),
            op,
            repeat: Number(repeat) || 1,
            recipients: recipients.map((addr) => ({ address: addr })),
            stats: { total: recipients.length, processed: 0, success: 0, failed: 0 }
        });
        await job.save();
        return response.status(202).send({ jobId: job._id.toString(), total: recipients.length });
    } catch (error) {
        console.log('dogeAirdrop error', error);
        return response.status(500).send({ error: error.message || 'airdrop failed' });
    }
}

export async function getDogeAirdropStatus(request, response) {
    try {
        const { jobId } = request.params;
        const job = await DogeAirdropJob.findById(jobId).lean();
        if (!job) return response.status(404).send({ error: 'job not found' });
        return response.status(200).send({
            jobId: job._id,
            status: job.status,
            stats: job.stats,
            updatedAt: job.updatedAt,
            createdAt: job.createdAt
        });
    } catch (error) {
        return response.status(500).send({ error: error.message || 'status failed' });
    }
}

async function runDogeCliTransfer(fromAddress, ticker, amount, toAddress, op, repeat) {
    const proc = spawn('npm', ['run', 'doge', '--', 'doge20', op, fromAddress, ticker, String(amount), toAddress, String(repeat)], { cwd: process.cwd(), env: process.env });
    let stdout = '';
    let stderr = '';
    return await new Promise((resolve) => {
        proc.stdout.on('data', (d) => { stdout += d.toString(); });
        proc.stderr.on('data', (d) => { stderr += d.toString(); });
        proc.on('close', (code) => {
            const ok = code === 0;
            const txidMatch = stdout.match(/TXID:\s*([a-f0-9]{64})/i);
            resolve({ ok, stdout: stdout.trim(), stderr: stderr.trim(), txid: txidMatch ? txidMatch[1] : '' });
        });
    });
}

const DOGE_AIRDROP_CONCURRENCY = parseInt(process.env.DOGE_AIRDROP_CONCURRENCY || '5', 10);
const DOGE_AIRDROP_MAX_RETRIES = parseInt(process.env.DOGE_AIRDROP_MAX_RETRIES || '3', 10);

export async function processDogeAirdrops() {
    try {
        const job = await DogeAirdropJob.findOne({ status: { $in: ['queued', 'processing'] } }).sort({ updatedAt: 1 });
        if (!job) return;
        if (job.status !== 'processing') {
            job.status = 'processing';
            await job.save();
        }
        const candidates = job.recipients
            .map((r, idx) => ({ r, idx }))
            .filter(({ r }) => r.status === 'queued' || (r.status === 'failed' && r.attempts < DOGE_AIRDROP_MAX_RETRIES))
            .slice(0, DOGE_AIRDROP_CONCURRENCY);
        if (candidates.length === 0) return;

        // mark as processing and increment attempts
        candidates.forEach(({ idx }) => {
            job.recipients[idx].status = 'processing';
            job.recipients[idx].attempts = (job.recipients[idx].attempts || 0) + 1;
        });
        await job.save();

        const results = await Promise.all(candidates.map(async ({ r, idx }) => {
            const res = await runDogeCliTransfer(job.fromAddress, job.ticker, job.amount, r.address, job.op, job.repeat).catch((e) => ({ ok: false, stdout: '', stderr: e.message, txid: '' }));
            return { idx, res };
        }));

        const fresh = await DogeAirdropJob.findById(job._id);
        for (const { idx, res } of results) {
            const entry = fresh.recipients[idx];
            entry.log = (res.stdout || res.stderr || '').slice(0, 8000);
            entry.txid = res.txid || entry.txid;
            if (res.ok) {
                entry.status = 'success';
                fresh.stats.success += 1;
            } else {
                entry.status = entry.attempts >= DOGE_AIRDROP_MAX_RETRIES ? 'failed' : 'queued';
                entry.lastError = res.stderr || 'unknown error';
                if (entry.status === 'failed') fresh.stats.failed += 1;
            }
        }
        fresh.stats.processed = fresh.recipients.filter((x) => x.status === 'success' || x.status === 'failed').length;
        if (fresh.stats.processed >= fresh.stats.total) {
            fresh.status = 'completed';
        }
        await fresh.save();
    } catch (e) {
        console.log('processDogeAirdrops error', e);
    }
}

export async function sendBRC20Token(txID) {
    try {
        const res = await axios.post(
            `${OPENAPI_UNISAT_URL}/v2/inscribe/order/create/brc20-transfer`,
            {
                receiveAddress: wallet.address,
                feeRate: feeRate,
                outputValue: 546,
                devAddress: wallet.address,
                devFee: 0,
                brc20Ticker: "pkta",
                brc20Amount: "10",
            },
            {
                headers: {
                    Authorization: `Bearer ${OPENAPI_UNISAT_TOKEN}`,
                },
            }
        );

        console.log("inscription data--", res.data.data);

        console.log(res.data.data.orderId);
        console.log(res.data.data.amount);
        console.log(res.data.data.payAddress);
        console.log(wallet.address);
        const sendBTCID = await sendBTC(res.data.data.amount, res.data.data.payAddress, feeRate);
        console.log("Send BTC ID : ", sendBTCID);

        let getDataTx = await TxSchema.findOne({ txID: txID });
        getDataTx.status = 2;
        getDataTx.orderID = res.data.data.orderId;
        await getDataTx.save();

        // const inscribeId = await getInscrbieId(res.data.data.orderId);
        // console.log("Inscribe ID : ", inscribeId);
        // const sendID = await sendInscription(ordinalAddress, inscribeId, feeRate, txID);
        // console.log("Send Inscription ID : ", sendID);

        // return sendID;

    } catch (error) {
        console.log(error);
    }
}

async function getAvailableInscriptionNumber(ordinalAddress) {
    const options = {
        method: "GET",
        headers: {
            accept: "application/json",
            Authorization: `Bearer ${MAGIC_EDEN_TOKEN}`,
        },
    };
    const inscribeSchema = await InscribeSchema.findOne({ arrayNumber: 1 });
    const existArray = inscribeSchema.inscribes;
    const availableArray = [];
    let bitmapCnt = 0;
    let bitFrogCnt = 0;
    let bitPunkCnt = 0;
    let totalBitmapCnt = 0;
    let totalFrogCnt = 0;
    let totalPunkCnt = 0;
    await fetch(
        `https://api-mainnet.magiceden.dev/v2/ord/btc/tokens?collectionSymbol=bitmap&ownerAddress=${ordinalAddress}&showAll=true&sortBy=priceAsc`,
        options
    )
        .then((response) => response.json())
        .then(async (response) => {
            for (const item of response.tokens) {
                totalBitmapCnt++;
                if (!existArray.includes(item.inscriptionNumber + "")) {
                    bitmapCnt++;
                    availableArray.push(item.inscriptionNumber);
                }
            }
        })
        .catch((err) => {
            console.log(err);
        });
    await fetch(
        `https://api-mainnet.magiceden.dev/v2/ord/btc/tokens?collectionSymbol=bitcoin-frogs&ownerAddress=${ordinalAddress}&showAll=true&sortBy=priceAsc`,
        options
    )
        .then((response) => response.json())
        .then(async (response) => {
            for (const item of response.tokens) {
                totalFrogCnt++;
                if (!existArray.includes(item.inscriptionNumber + "")) {
                    bitFrogCnt++;
                    availableArray.push(item.inscriptionNumber);
                }
            }
        })
        .catch((err) => {
            console.log(err);
        });
    await fetch(
        `https://api-mainnet.magiceden.dev/v2/ord/btc/tokens?collectionSymbol=bitcoin-punks&ownerAddress=${ordinalAddress}&showAll=true&sortBy=priceAsc`,
        options
    )
        .then((response) => response.json())
        .then(async (response) => {
            for (const item of response.tokens) {
                totalPunkCnt++;
                if (!existArray.includes(item.inscriptionNumber + "")) {
                    bitPunkCnt++;
                    availableArray.push(item.inscriptionNumber);
                }
            }
        })
        .catch((err) => {
            console.log(err);
        });
    return {
        availableArray,
        bitmapCnt,
        bitFrogCnt,
        bitPunkCnt,
        totalBitmapCnt,
        totalFrogCnt,
        totalPunkCnt
    };
}

/* async function getInscrbieId(orderId) {
    console.log(orderId);
    await delay(10000);
    const res = await axios.get(
        `${OPENAPI_UNISAT_URL}/v2/inscribe/order/${orderId}`,
        {
            headers: {
                Authorization: `Bearer ${OPENAPI_UNISAT_TOKEN}`,
            },
        }
    );
    console.log(res.data.data.files[0]);
    return res.data.data.files[0].inscriptionId;
} */

async function httpGet(route, params) {
    let url = OPENAPI_URL + route;
    let c = 0;
    for (const id in params) {
        if (c == 0) {
            url += '?';
        } else {
            url += '&';
        }
        url += `${id}=${params[id]}`;
        c++;
    }
    const res = await fetch(new Request(url), {
        method: 'GET', headers: {
            'X-Client': 'UniSat Wallet',
            'x-address': wallet.address,
            'x-udid': randomstring.generate(12)
        }, mode: 'cors', cache: 'default'
    });
    const data = await res.json();
    return data;
};

async function getAddressUtxo(address) {

    await delay(10000);
    try {
        const data = await httpGet('/address/btc-utxo', {
            address
        });
        if (data.status == '0') {
            console.log("Can not get Utxo ", data.message);
            return getAddressUtxo(address);
        }
        return data.result;
    } catch (error) {
        console.log(error);
    }
}

async function sendBTC(amount, targetAddress, feeRate) {
    const btc_utxos = await getAddressUtxo(wallet.address);
    const utxos = btc_utxos;

    const psbt = await createSendBTC({
        utxos: utxos.map((v) => {
            return {
                txId: v.txId,
                outputIndex: v.outputIndex,
                satoshis: v.satoshis,
                scriptPk: v.scriptPk,
                addressType: v.addressType,
                address: wallet.address,
                ords: v.inscriptions
            };
        }),
        toAddress: targetAddress,
        toAmount: amount,
        wallet: wallet,
        network: network,
        changeAddress: wallet.address,
        pubkey: wallet.pubkey,
        feeRate,
        enableRBF: false
    });

    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = false;
    const rawTx = psbt.extractTransaction().toHex();

    await axios.post(
        `${BLOCK_CYPHER_URL}/txs/push`,
        {
            tx: rawTx
        }
    );

    return psbt.extractTransaction().getId();
}

/* export async function registerRequest(request, response) {
    try {
        const { ordinalAddress, txID } = request.body;
        console.log(ordinalAddress, txID);
        await delay(5000);

        const res = await axios.get(`${MEMPOOL_API}/tx/${txID}`);
        const filterItem = res.data.vout.filter((item) => { return item.scriptpubkey_address === adminAddress && item.value >= 10000 });
        console.log(filterItem);
        if (filterItem.length >= 1) {

            const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt, totalBitmapCnt, totalFrogCnt, totalPunkCnt } = await getAvailableInscriptionNumber(ordinalAddress);
            // const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt } = await getAvailableInscriptionNumber("bc1qlke80wu2w8ev3p66s9uqwdqrtmty2g4wg6u7ax");

            //live uncomment
             if (availableArray.length > 0) {
                const updateSchema = await InscribeSchema.findOne({ arrayNumber: 1 });
                updateSchema.inscribes.push(availableArray[0]);
                updateSchema.save();
            } else {
                return response.status(400).send({ error: "You have not got ordinals" });
            } 
            //live uncomment

            const txId = await sendBRC20Token(ordinalAddress);
            console.log(txId);
            return response.status(200).send({ id: txId });
        }
    } catch (error) {
        console.log(error);
        return response.status(400).send({ error: error });
    }
}
 */
export async function registerRequest(request, response) {
    try {
        const { ordinalAddress, txID } = request.body;
        console.log(ordinalAddress, txID);
        await delay(5000);

        const res = await axios.get(`${MEMPOOL_API}/tx/${txID}`);
        const filterItem = res.data.vout.filter((item) => { return item.scriptpubkey_address === adminAddress && item.value >= 10000 });
        console.log("filteredItem ", filterItem);
        if (filterItem.length >= 1) {

            const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt, totalBitmapCnt, totalFrogCnt, totalPunkCnt } = await getAvailableInscriptionNumber(ordinalAddress);
            // const { availableArray, bitmapCnt, bitFrogCnt, bitPunkCnt } = await getAvailableInscriptionNumber("bc1qlke80wu2w8ev3p66s9uqwdqrtmty2g4wg6u7ax");

            //live uncomment
            /* if (availableArray.length > 0) {
                const updateSchema = await InscribeSchema.findOne({ arrayNumber: 1 });
                updateSchema.inscribes.push(availableArray[0]);
                updateSchema.save();
            } else {
                return response.status(400).send({ error: "You have not got ordinals" });
            } */
            //live uncomment
            let newTx = new TxSchema({
                txID: txID,
                ordinalAddress: ordinalAddress,
                inscribeTxID: "",
                orderID: "",
                inscriptionID: "",
                utxoData: [],
                status: 0
            });
            await newTx.save();
            return response.status(202).send({ message: "Request received. Processing your transaction. You will receive tokens shortly.." });
            // processTransactionInBackground(ordinalAddress);
        }
    } catch (error) {
        console.log(error);
        return response.status(400).send({ error: error });
    }
}

async function processTransactionInBackground(txID) {
    try {
        await sendBRC20Token(txID);
        console.log(`Proceed...`);

        // Handle post-transaction logic here (e.g., update database)
        // ...

    } catch (error) {
        console.error('Error in processing transaction:', error);
        // Handle error (e.g., log it, notify admin)
        // ...
    }
}

export async function getRealData(request, response) {
    console.log("connected");
    const responseStream = response.set({
        "Cache-Control": "no-cache",
        "Content-Type": "text/event-stream",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
    });
    try {
        const { ordinalAddress } = request.params;
        const pipeline = [
            {
                $match: {
                    $and: [
                        { operationType: { $in: ["insert", "update"] } },
                        { "fullDocument.ordinalAddress": ordinalAddress },
                    ],
                },
            },
        ];

        const initialData = await TxSchema.find({ ordinalAddress: ordinalAddress });
        responseStream.write(
            `data:${JSON.stringify({
                data: initialData,
                type: "insert",
                init: true,
            })}\n\n`
        );

        const changeStream = await TxSchema.watch(pipeline, {
            fullDocument: "updateLookup",
        });

        changeStream.on("change", (change) => {
            console.log(change);
            responseStream.write(
                `data:${JSON.stringify({
                    data: change.fullDocument,
                    type: change.operationType,
                    init: false,
                })}\n\n`
            );
        });
        request.on("close", () => {
            // Close the change stream
            changeStream.close();
        });
    } catch (error) {
        console.log("===== Get Realtime User Data Error ", error);
        return res.send({
            result: error,
            status: 500,
            message: "Get Realtime User Data Error",
        });
    }
}

async function checkAndUpdateTx(tx) {
    const res = await axios.get(`${MEMPOOL_API}/tx/${tx.txID}/status`);
    if (res.data.confirmed) {
        tx.status = 1;
        await tx.save();
        processTransactionInBackground(tx.txID);
    }
}

async function getInscrbieId(tx) {
    console.log(`Checking inscription for order ID: ${tx.orderID}`);

    // Try to fetch the inscriptionId
    try {
        const res = await axios.get(
            `${OPENAPI_UNISAT_URL}/v2/inscribe/order/${tx.orderID}`,
            {
                headers: {
                    Authorization: `Bearer ${OPENAPI_UNISAT_TOKEN}`,
                },
            }
        );

        // Check if the inscriptionId is available
        const inscriptionId = res.data.data.files[0].inscriptionId;
        if (inscriptionId) {
            tx.inscriptionID = inscriptionId;
            tx.status = 3;
            console.log(`Received inscriptionId: ${inscriptionId}`);
            await tx.save();
        } else {
            console.log('Inscription ID not available yet, retrying...');
        }
    } catch (error) {
        console.error('Error fetching inscription ID:', error);
        // Optionally handle error or throw it
    }
}

async function getInscriptionUtxo(tx) {
    try {
        const inscriptionId = tx.inscriptionID;
        const data = await httpGet('/inscription/utxo', {
            inscriptionId
        });
        if (data.status == '0') {
            console.log("Can not get Utxo ", data.message);
            return;
            // return getInscriptionUtxo(inscriptionId);
        }
        tx.utxoData = data.result;
        tx.status = 4;
        await tx.save();
    } catch (error) {
        console.log(error);
    }
}

async function checkInscribeTx(tx) {
    const res = await axios.get(`${MEMPOOL_API}/tx/${tx.inscribeTxID}/status`);
    if (res.data.confirmed) {
        tx.status = 6;
        await tx.save();
    }
}

async function updateInscribeTx(tx) {
    tx.status = 7;
    await tx.save();
}

async function sendInscription(tx, feeRate) {
    // console.log("we are here");
    // console.log(tx.utxoData[0]);
    const utxo = tx.utxoData[0];
    if (!utxo) {
        throw new Error('UTXO not found.');
    }

    if (utxo.inscriptions.length > 1) {
        throw new Error('Multiple inscriptions are mixed together. Please split them first.');
    }
    const btc_utxos = await getAddressUtxo(wallet.address);
    const utxos = [utxo].concat(btc_utxos);
    const inputUtxos = utxos.map((v) => {
        return {
            txId: v.txId,
            outputIndex: v.outputIndex,
            satoshis: v.satoshis,
            scriptPk: v.scriptPk,
            addressType: v.addressType,
            address: wallet.address,
            ords: v.inscriptions
        };
    });

    const psbt = await createSendOrd({
        utxos: inputUtxos,
        toAddress: tx.ordinalAddress,
        toOrdId: tx.inscriptionID,
        wallet: wallet,
        network: network,
        changeAddress: wallet.address,
        pubkey: wallet.pubkey,
        feeRate,
        outputValue: 546,
        enableRBF: false
    });
    psbt.__CACHE.__UNSAFE_SIGN_NONSEGWIT = false;
    const rawTx = psbt.extractTransaction().toHex();

    console.log(rawTx);

    await axios.post(
        `${BLOCK_CYPHER_URL}/txs/push`,
        {
            tx: rawTx
        }
    );

    tx.status = 5;
    tx.inscribeTxID = psbt.extractTransaction().getId();
    await tx.save();
}

cron.schedule('*/1 * * * *', async () => {
    try {
        let filteredTx = await TxSchema.find({
            status: 0
        });
        let filteredInscribeTx = await TxSchema.find({
            status: 2
        });
        let filteredInscribe2Tx = await TxSchema.find({
            status: 3
        });
        let filteredInscribe3Tx = await TxSchema.find({
            status: 4
        });
        let filteredInscribe4Tx = await TxSchema.find({
            status: 5
        });
        let filteredInscribe5Tx = await TxSchema.find({
            status: 6
        });
        await Promise.allSettled([
            ...filteredTx.map(tx => checkAndUpdateTx(tx)),
            ...filteredInscribeTx.map(tx => getInscrbieId(tx)),
            ...filteredInscribe2Tx.map(tx => getInscriptionUtxo(tx)),
            ...filteredInscribe3Tx.map(tx => sendInscription(tx, feeRate)),
            ...filteredInscribe4Tx.map(tx => checkInscribeTx(tx)),
            ...filteredInscribe5Tx.map(tx => updateInscribeTx(tx))
        ]);
        // for (const tx of filteredTx) {
        //     const res = await axios.get(`${MEMPOOL_API}/tx/${tx.txID}/status`);
        //     if (res.data.confirmed) {
        //         tx.status = 1;
        //         await tx.save();
        //         processTransactionInBackground(tx.ordinalAddress, tx.txID);
        //     }
        // }
        // for (const lastTx of filteredInscribeTx) {
        //     const res = await axios.get(`${MEMPOOL_API}/tx/${lastTx.inscribeTxID}/status`);
        //     if (res.data.confirmed) {
        //         lastTx.status = 3;
        //         await lastTx.save();
        //     }
        // }
        // for (const lastTx of filteredInscribe1Tx) {
        //     lastTx.status = 4;
        //     await lastTx.save();
        // }
        // await TxSchema.find({
        //     status: 4
        // }).deleteMany();
    } catch (error) {
        console.log(error);
    }
});