// Dependencies
const dotenv = require('dotenv');
const { Client, Intents, MessageEmbed } = require('discord.js');
const { ethers, Contract, BigNumber } = require("ethers");
const publicIp = require('public-ip');
const swapABI = require('./constants/swapABI.json');
const contracts = require('./constants/contracts.json');
const retry = require('async-retry');
const fetch = require('node-fetch');

// Set up dotenv config and discord bot
dotenv.config();
const bot = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
const provider = new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_API);
const isProduction = !process.env.ALCHEMY_API.includes("127.0.0.1")
const coinGeckoAPI = "https://api.coingecko.com/api/v3/simple/price"
const SADDLE_TEAM_ROLE = 780548108156665867

const formatter = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
});

async function queryTokenPricesUSD(tokenIDs) {
    return await retry(async bail => {
        // if anything throws, we retry
        const res = await fetch(`${coinGeckoAPI}?ids=${encodeURIComponent(tokenIDs.join(","))}&vs_currencies=usd`)

        if (403 === res.status) {
            // don't retry upon 403
            bail(new Error('Unauthorized'))
            return
        }

        return res.json()
    }, {
        retries: 5
    })
}

function getChannel(channelID) {
    return bot.channels.cache.get(channelID);
}

async function log(message) {
    return getChannel(process.env.DISCORD_LOG_CHANNEL_ID).send(message);
}

async function send(message) {
    return getChannel(process.env.DISCORD_CHANNEL_ID).send(message);
}

function toHumanString(rawTokenAmount, decimals, digitsToShow) {
    let s = BigNumber.from(rawTokenAmount).div(BigNumber.from(10).pow(decimals - digitsToShow)).toNumber();
    s = s / (10 ** digitsToShow)
    if (s === 0) {
        return "0";
    } else {
        return s.toFixed(digitsToShow);
    }
}

function calculateExchangeRate(sellAmount, buyAmount) {
    return buyAmount / sellAmount
}

function toUSD(s) {
    return formatter.format(parseFloat(s))
}

function formatNum(num) {
    return BigNumber.from(parseInt(parseFloat(num.toFixed(2)) * 100))
}

async function main() {
    bot.on('ready', async () => {
        console.log(`Logged in as ${bot.user.tag}!`);
        log(`Bot started at ${await publicIp.v4()}. Using ${process.env.ALCHEMY_API} as the json rpc endpoint...`)
    });

    bot.on('message', msg => {
        if (msg.content === 'ping') {
            send('pong');
        }
    });

    for (const contract of contracts) {
        const contractAddress = isProduction ? contract["address"] : contract["localAddress"]
        const instance = new Contract(contractAddress, swapABI, provider)

        // On token swap event
        instance.on("TokenSwap", async (buyer, tokensSold, tokensBought, soldId, boughtId, event) => {
            const soldTokenName = contract["tokens"][soldId]
            const boughtTokenName = contract["tokens"][boughtId]

            const digitsToShow = 4

            const prices = await queryTokenPricesUSD(contract["coingeckoIDs"])

            const numOfTokenSold = toHumanString(tokensSold, contract["decimals"][soldId], digitsToShow)
            const numOfTokenBought = toHumanString(tokensBought, contract["decimals"][boughtId], digitsToShow)

            const totalUSDValueSold = toUSD(toHumanString(
                BigNumber.from(tokensSold).mul(formatNum(prices[`${contract["coingeckoIDs"][soldId]}`]["usd"])).div(100),
                contract["decimals"][soldId],
                digitsToShow
            ))
            const totalUSDValueBought = toUSD(toHumanString(
                BigNumber.from(tokensBought).mul(formatNum(prices[`${contract["coingeckoIDs"][boughtId]}`]["usd"])).div(100),
                contract["decimals"][boughtId],
                digitsToShow
            ))
            const fee = (numOfTokenBought * 0.0004 / (1 - 0.0004))
            const totalUSDFee = toUSD( fee * prices[`${contract["coingeckoIDs"][boughtId]}`]["usd"])
            const exchangeRate = calculateExchangeRate(numOfTokenSold * 1, numOfTokenBought * 1)
            // inside a command, event listener, etc.
            let embed = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Token swap')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], contract["authorThumbnailURL"], `https://etherscan.io/address/${contractAddress}`)
                .setDescription(`${buyer} swapped ${soldTokenName} to ${boughtTokenName}`)
                .addFields(
                    { name: 'Input amount', value: `${numOfTokenSold} ${soldTokenName} (${totalUSDValueSold})`, inline: true },
                    { name: 'Output amount', value: `${numOfTokenBought} ${boughtTokenName} (${totalUSDValueBought})`, inline: true },
                )
                .addField(`Fees gained by LPs`, `${fee.toFixed(digitsToShow)} ${boughtTokenName} (${totalUSDFee})`, false)
                .setTimestamp()
            
                if(exchangeRate <= 0.97) {
                    embed.addField('Exchange rate', `1:${exchangeRate.toFixed(3)} (attn: <@&${SADDLE_TEAM_ROLE}>)`)
                }

            if (!isProduction) {
                embed = embed.setFooter(`Hardhat network`)
            }

            send(embed);
            log(JSON.stringify(event));
        });

        // On AddLiquidity event
        instance.on("AddLiquidity", async (provider, tokenAmounts, fees, invariant, lpTokenSupply, event) => {
            const digitsToShow = 3

            const depositAmounts = tokenAmounts.map((amount, i) =>
                `${toHumanString(amount, contract["decimals"][i], digitsToShow)} ${contract["tokens"][i]}`
            ).join(', ')

            const prices = await queryTokenPricesUSD(contract["coingeckoIDs"])
            const totalDollarValue = tokenAmounts.map((amount, i) =>
                toHumanString(BigNumber.from(amount).mul(formatNum(prices[`${contract["coingeckoIDs"][i]}`]["usd"])).div(100), contract["decimals"][i], digitsToShow)
            ).reduce((a, val) => a + parseFloat(val), 0)

            // inside a command, event listener, etc.
            let embed = new MessageEmbed()
                .setColor('#33ff33')
                .setTitle('Deposit')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], contract["authorThumbnailURL"], `https://etherscan.io/address/${contractAddress}`)
                .setDescription(`${provider} added new liquidity to the ${contract['name']}`)
                .addFields(
                    { name: 'Deposit amounts', value: `${depositAmounts}`, inline: false },
                    {name: "Total USD value", value: `${toUSD(totalDollarValue)}`, inline: false}
                )
                .setTimestamp()

            if (!isProduction) {
                embed = embed.setFooter(`Hardhat network`)
            }

            send(embed);
            log(JSON.stringify(event));
        });

        // On RemoveLiquidity event
        instance.on("RemoveLiquidity", async (provider, tokenAmounts, lpTokenSupply, event) => {
            const digitsToShow = 3

            const withdrawAmounts = tokenAmounts.map((amount, i) =>
                `${toHumanString(amount, contract["decimals"][i], digitsToShow)} ${contract["tokens"][i]}`
            ).join(', ')

            const prices = await queryTokenPricesUSD(contract["coingeckoIDs"])
            const totalDollarValue = tokenAmounts.map((amount, i) =>
                toHumanString(BigNumber.from(amount).mul(formatNum(prices[`${contract["coingeckoIDs"][i]}`]["usd"])).div(100), contract["decimals"][i], digitsToShow)
            ).reduce((a, val) => a + parseFloat(val), 0)

            // inside a command, event listener, etc.
            let embed = new MessageEmbed()
                .setColor('#FF9A00')
                .setTitle('Withdraw')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], contract["authorThumbnailURL"], `https://etherscan.io/address/${contractAddress}`)
                .setDescription(`${provider} removed liquidity from the ${contract['name']}`)
                .addFields(
                    { name: 'Withdraw amounts', value: `${withdrawAmounts}`, inline: false },
                    {name: "Total USD value", value: `${toUSD(totalDollarValue)}`, inline: false}

                )
                .setTimestamp()

            if (!isProduction) {
                embed = embed.setFooter(`Hardhat network`)
            }

            send(embed);
            log(JSON.stringify(event));
        });

        // On RemoveLiquidity event
        instance.on("RemoveLiquidityOne", async (provider, lpTokenAmount, lpTokenSupply, boughtId, tokensBought, event) => {
            const digitsToShow = 3
            const withdrawAmounts = `${toHumanString(tokensBought, contract["decimals"][boughtId], digitsToShow)} ${contract["tokens"][boughtId]}`;

            const prices = await queryTokenPricesUSD(contract["coingeckoIDs"])
            const totalDollarValue =
                toHumanString(BigNumber.from(tokensBought).mul(formatNum(prices[`${contract["coingeckoIDs"][boughtId]}`]["usd"])).div(100), contract["decimals"][boughtId], digitsToShow)

            // inside a command, event listener, etc.
            let embed = new MessageEmbed()
                .setColor('#FF9A00')
                .setTitle('Withdraw')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], contract["authorThumbnailURL"], `https://etherscan.io/address/${contractAddress}`)
                .setDescription(`${provider} removed liquidity from the ${contract['name']}`)
                .addFields(
                    { name: 'Withdraw amounts', value: `${withdrawAmounts}`, inline: false },
                    {name: "Total USD value", value: `${toUSD(totalDollarValue)}`, inline: false}
                )
                .setTimestamp()

            if (!isProduction) {
                embed = embed.setFooter(`Hardhat network`)
            }

            send(embed);
            log(JSON.stringify(event));
        });

        // On RemoveLiquidity event
        instance.on("RemoveLiquidityImbalance", async (provider, tokenAmounts, fees, invariant, lpTokenSupply, event) => {
            const digitsToShow = 4
            const withdrawAmounts = tokenAmounts.map((amount, i) =>
                `${toHumanString(amount, contract["decimals"][i], digitsToShow)} ${contract["tokens"][i]}`
            ).join(', ')

            const prices = await queryTokenPricesUSD(contract["coingeckoIDs"])
            const totalDollarValue = tokenAmounts.map((amount, i) =>
                toHumanString(BigNumber.from(amount).mul(formatNum(prices[`${contract["coingeckoIDs"][i]}`]["usd"])).div(100), contract["decimals"][i], digitsToShow)
            ).reduce((a, val) => a + parseFloat(val), 0)

            // inside a command, event listener, etc.
            let embed = new MessageEmbed()
                .setColor('#FF9A00')
                .setTitle('Withdraw')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], contract["authorThumbnailURL"], `https://etherscan.io/address/${contractAddress}`)
                .setDescription(`${provider} removed liquidity from the ${contract['name']}`)
                .addFields(
                    { name: 'Withdraw amounts', value: `${withdrawAmounts}`, inline: false },
                    {name: "Total USD value", value: `${toUSD(totalDollarValue)}`, inline: false}

                )
                .setTimestamp()

            if (!isProduction) {
                embed = embed.setFooter(`Hardhat network`)
            }

            send(embed);
            log(JSON.stringify(event));
        });
    }

    await bot.login(process.env.DISCORD_BOT_TOKEN);
}

main();