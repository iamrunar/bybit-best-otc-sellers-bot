#!/usr/bin/env node

const TelegramBot = require('node-telegram-bot-api');
require('dotenv').config();

class BybitError extends Error {
    response;

    constructor(message, response){
        super(message)
        this.response = response;
    }
}


let finishBybitScan = true;

const waitForNextDelay = 5000;
const defaultUserAmountRange = {min: 10_000,max:400_000};
const API_KEY_BOT = process.env.API_KEY_BOT
const ALLOW_TELEGRAM_USER_ID = Number(process.env.ALLOW_TELEGRAM_USER_ID)

const acceptedTelegramUsers = [ALLOW_TELEGRAM_USER_ID];
const botCommands = [ { command: 'start', description: 'Запуск бота'},
{ command: 'setup', description: 'Настроить'},
{ command: 'watch', description: 'Приступить к наблюдению'},
{ command: 'stop_watch', description: 'Остановить наблюдение'},
{ command: 'stop', description: 'Остановка бота'}] ;
let bybitSecureToken;
const bot = new TelegramBot(API_KEY_BOT, {
    polling: true,
    interval: 1000,
});
let telegramLastMessageId;
bot.setMyCommands(botCommands);
let botGlobalState = 'none';
let botInitializedState = 'none';
let botSetupState = 'none'
let botReadyToWatchState = 'none'
let userAmountRange;
bot.on("polling_error", err => console.error('TelegramBot error', err));
bot.on('text', async msg => {
    console.log('Hello',acceptedTelegramUsers,msg.from.id)
    if (!acceptedTelegramUsers.includes(msg.from.id)){
        return;
    }

    if (msg.text==='/start'){
        console.log('Hello',msg.chat.first_name, msg.chat.last_name);

        // reset all
        botGlobalState = 'none';
        botInitializedState = 'none';
        botSetupState = 'none';
        botReadyToWatchState = 'none';
        finishBybitScan = true;

        await actionGlobal(msg);
    }
    else if (msg.text==='/setup'){
        console.log('Setup for',msg.chat.first_name, msg.chat.last_name);
        botInitializedState = 'setup';
        await actionGlobal(msg);
    }
    else if (msg.text==='/watch'){
        console.log('Watch for',msg.chat.first_name, msg.chat.last_name);
        // skip set userAmountRange
        userAmountRange ||= defaultUserAmountRange;
        await printInfoToTelegram(msg.chat.id, `MinPrice=${userAmountRange.min} MaxPrice=${userAmountRange.max}\nStarting.`);
        botInitializedState = 'ready';
        botReadyToWatchState = 'canStart';
        actionGlobal(msg);
    }
    else if (msg.text==='/quick_watch'){
    }
    else if (msg.text==='/stop_watch'){
        console.log('stop_watch',msg.chat.first_name, msg.chat.last_name);
        if (botReadyToWatchState==='started'){
            console.log('Stopping');
            await printInfoToTelegram(msg.chat.id, 'Stopping');
            botReadyToWatchState = 'stopping';
            actionGlobal(msg);
        }
        else {
            console.log('Not started',msg.chat.first_name, msg.chat.last_name);
            await printInfoToTelegram(msg.chat.id, 'Im not started');
        }
    }
    else if (msg.text==='/stop'){
        console.log('Stopping for',msg.chat.first_name, msg.chat.last_name)
        await printInfoToTelegram(msg.chat.id, 'Stopping');

        // force stop all
        bybitSecureToken = undefined;
        finishBybitScan = true;
        botGlobalState = 'none';
        botReadyToWatchState = 'none';
    }
    else {
        console.log('Received message')
        await actionGlobal(msg);
    }
});

async function actionGlobal(msg){
    console.log('actionGlobal', botGlobalState,botReadyToWatchState, msg.text)
    const chatId = msg.chat.id;
    const text = msg.text;
    switch (botGlobalState){
        case 'none':
            botGlobalState = 'secureToken';
            await printInfoToTelegram(chatId, 'Hello ' + msg.chat.first_name+'\nSend me your secure token');
            break;
        case 'secureToken':
            botGlobalState = 'initialized'
            bybitSecureToken = text;
            await printInfoToTelegram(chatId, 'Ok. Now. You can watch / quick_watch');
            break;
        case 'initialized':
            await actionInitialized(msg)
            break;
    }
}

async function actionInitialized(msg){
    console.log('actionInitialized', botInitializedState, msg.text)
    switch (botInitializedState){
        case 'setup':
            await actionSetup(msg);
            break;
        case 'ready':
            await actionReadyToWatchState(msg);
            break;
    }
}

async function actionSetup(msg){
    const chatId = msg.chat.id;
    const text= msg.text;
    switch (botSetupState){
        case 'none':
            botSetupState = 'fillMin';
            await printInfoToTelegram(chatId, `Send me min price. Or send any text for min = ${defaultUserAmountRange.min}`);
            break;
        case 'fillMin':
            let minPrice = text ? Number.parseInt(text) : NaN;
            if (isNaN(minPrice)){
                minPrice= defaultUserAmountRange.min;
            }

            (userAmountRange||={}).min = minPrice;
            await printInfoToTelegram(chatId, `Ok. MinPrice=${minPrice}.\nNow send me your max price. Or send any text for max = ${defaultUserAmountRange.max}`);
            botSetupState = 'fillMax';
            break;
        case 'fillMax':
            let maxPrice = text ? Number.parseInt(text) : NaN;
            if (isNaN(maxPrice)){
                maxPrice = defaultUserAmountRange.max;
            }

            if (userAmountRange.min > maxPrice){
                await printInfoToTelegram(chatId, 'MinPrice should be less or equal MaxPrice. You can keep empty for MaxPrice = '+defaultUserAmountRange.max);
                return;
            }
            userAmountRange.max = maxPrice;
            await printInfoToTelegram(chatId, `Nice. MaxPrice=${maxPrice}.\nNow you can start watch`);
            botSetupState = 'none';

            botInitializedState = 'ready'
            break;
        }
}

async function actionReadyToWatchState(msg){
    console.log('actionReadyToWatchState', botReadyToWatchState, msg.text)
    const chatId = msg.chat.id;
    const text = msg.text;
    switch (botReadyToWatchState){
        case 'none':
            botReadyToWatchState = 'canStart';
            break;
        case 'canStart':
            botReadyToWatchState = 'started';
            finishBybitScan = false;
            startCheckMinPrice(chatId, userAmountRange);
            break;
        // ...
        case 'stopping':
            finishBybitScan = true;
            botReadyToWatchState = 'none';
            break;
    }
}

async function startCheckMinPrice(chatId,userAmountRange){
    let minUser;
    while (!finishBybitScan){
        try {
            console.log('Next request');
            const responseBody = await requestItems();
            if (responseBody.ret_code!==0){
                console.error('  Bybit return error', responseBody.ret_code, responseBody.ret_msg);
                break;
            }
            const result = responseBody.result;
            if (result.count === 0){
                console.warn('  No data');
            }
            // console.log('  Response ok',result.count)
            const items = result.items;
            if (minUser){
                const foundUser = items.find(i=>i.id===minUser.userId);
                if (!foundUser){
                    console.log(`MinUser not found. Reset min`)
                    printInfoToTelegram(chatId, `MinUser not found. Reset min`);
                    minUser = null;
                }
            }
            const foundSuitableItem = findFirstItemWithAmount(items, userAmountRange);
            if (!foundSuitableItem){
                console.log(`No suitable items with user amount range ${userAmountRange[0]}-${userAmountRange[1]}`)
                printInfoToTelegram(chatId, `No suitable items with user amount range ${userAmountRange[0]}-${userAmountRange[1]}`);
            }
            else {
                const price = foundSuitableItem.price;
                if (!minUser || price < minUser.price){
                    minUser = {price, userId: foundSuitableItem.id}
                    printItemToTelegram(chatId, foundSuitableItem);
                }
            }
    
        } catch (error) {
            if (error instanceof BybitError){
                console.error('Bybit return error', error.response.status, error.response.statusText);
                await delay(5000);
            }
            else {
                console.error('Error', error);
                break;
            }
    
        }
        console.log('  Wait before next request');
        await delay(waitForNextDelay);
    }
    printInfoToTelegram(chatId, `Finished`, true);
}

function printItem(item){
    console.log(`${item.nickName} (${item.id}): ${item.price}rub [${item.minAmount}-${item.maxAmount}]`);
}

async function printInfoToTelegram(chatId, text, clearLastMessage = false){
    const message = await bot.sendMessage(chatId, text);
    if (clearLastMessage && telegramLastMessageId){
        bot.deleteMessage(chatId, telegramLastMessageId)
    }
    telegramLastMessageId = message.message_id
}

function printItemToTelegram(chatId, item){
    const text = `${item.nickName} (${item.id}): ${item.price}rub [${item.minAmount}-${item.maxAmount}]`;
    return bot.sendMessage(chatId, text);
}

function findFirstItemWithAmount(items, userAmountRange){
    return items.find(x=>
        x.maxAmount>=userAmountRange.min &&
        x.minAmount<=userAmountRange.max)
}

async function requestItems(){
    const body = {
        tokenId: "USDT",
        currencyId: "RUB",
        payment: ["75"],
        side: "1",
        size: "10",
        page: "1",
        amount: "",
        authMaker: true,
        canTrade: true
    }
    const response = await fetch('https://api2.bybit.com/fiat/otc/item/online', {
        method: 'post',
        headers:{
            accept: 'application/json',
            cookie: `secure-token=${bybitSecureToken}`,
        },
        body:JSON.stringify(body),
    });

    if (!response.ok){
        throw new BybitError('Bybit server return error', { status: response.status, statusText: response.statusText})
    }
    const responseBody = await response.json();
    return responseBody;
}

function delay(msec){
    return new Promise((resolve, reject)=>setTimeout(resolve, msec));
}