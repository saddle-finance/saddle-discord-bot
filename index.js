// Dependencies
const dotenv = require('dotenv');
const { Client, Intents, MessageEmbed } = require('discord.js');
const { ethers, Contract, BigNumber } = require("ethers");
const publicIp = require('public-ip');
const swapABI = require('./constants/swapABI.json');
const contracts = require('./constants/contracts.json');

// Set up dotenv config and discord bot
dotenv.config();
const bot = new Client({ intents: [Intents.FLAGS.GUILDS, Intents.FLAGS.GUILD_MESSAGES] });
const provider =  new ethers.providers.JsonRpcProvider(process.env.ALCHEMY_API);

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
    let s = BigNumber.from(rawTokenAmount).div(BigNumber.from(10).pow(decimals - digitsToShow)).toString();
    return s.slice(0, -digitsToShow) + "." + s.slice(-digitsToShow);
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
        const instance = new Contract(contract["address"], swapABI, provider)

        // On token swap event
        instance.on("TokenSwap", (buyer, tokensSold, tokensBought, soldId, boughtId, event) => {
            const soldTokenName = contract["tokens"][soldId]
            const boughtTokenName = contract["tokens"][boughtId]

            const digitsToShow = 4

            const numOfTokenSold = toHumanString(tokensSold, contract["decimals"][soldId], digitsToShow)
            const numOfTokenBought = toHumanString(tokensBought, contract["decimals"][boughtId], digitsToShow)

            // inside a command, event listener, etc.
            const embed = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Token swap')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], null, `https://etherscan.io/address/${contract["address"]}`)
                .setDescription(`${buyer} swapped ${soldTokenName} to ${boughtTokenName}`)
                .addFields(
                    { name: 'Input amount', value: `${numOfTokenSold} ${soldTokenName} ($0)`, inline: true },
                    { name: 'Output amount', value: `${numOfTokenBought} ${boughtTokenName} ($0)`, inline: true },
                )
                .addField(`Fees gained by LPs`, "0", false)
                .setTimestamp()
                .setFooter('Some footer text here', 'https://i.imgur.com/wSTFkRM.png');

            send(embed);
            log(JSON.stringify(event));
        });

        // On AddLiquidity event
        instance.on("AddLiquidity", (provider, tokenAmounts, fees, invariant, lpTokenSupply, event) => {
            let depositAmounts = "";

            const digitsToShow = 3
            for (let i = 0; i < tokenAmounts.length; i++) {
                depositAmounts += `${contract["tokens"][i]} ${toHumanString(tokenAmounts[i], contract["decimals"][i], digitsToShow)}, `
            }
            depositAmounts = depositAmounts.slice(0, -2)

            // inside a command, event listener, etc.
            const embed = new MessageEmbed()
                .setColor('#33ff33')
                .setTitle('Deposit')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], null, `https://etherscan.io/address/${contract["address"]}`)
                .setDescription(`${provider} added new liquidity to the ${contract['name']}`)
                .addFields(
                    { name: 'Deposit amounts', value: `${depositAmounts} ($0)`, inline: false },
                )
                .setTimestamp()
                .setFooter('Some footer text here', 'https://i.imgur.com/wSTFkRM.png');

            send(embed);
            log(JSON.stringify(event));
        });

        // On RemoveLiquidity event
        instance.on("RemoveLiquidity", (provider, tokenAmounts, lpTokenSupply, event) => {
            let withdrawAmounts = "";

            const digitsToShow = 3
            for (let i = 0; i < tokenAmounts.length; i++) {
                withdrawAmounts += `${toHumanString(tokenAmounts[i], contract["decimals"][i], digitsToShow)} ${contract["tokens"][i]} , `
            }
            withdrawAmounts = withdrawAmounts.slice(0, -2)

            // inside a command, event listener, etc.
            const embed = new MessageEmbed()
                .setColor('#FF9A00')
                .setTitle('Withdraw')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], null, `https://etherscan.io/address/${contract["address"]}`)
                .setDescription(`${provider} removed liquidity from the ${contract['name']}`)
                .addFields(
                    { name: 'Withdraw amounts', value: `${withdrawAmounts} ($0)`, inline: false },
                )
                .setTimestamp()
                .setFooter('Some footer text here', 'https://i.imgur.com/wSTFkRM.png');

            send(embed);
            log(JSON.stringify(event));
        });

        // On RemoveLiquidity event
        instance.on("RemoveLiquidityOne", (provider, lpTokenAmount, lpTokenSupply, boughtId, tokensBought, event) => {
            const digitsToShow = 3

            const withdrawAmounts = `${toHumanString(tokensBought, contract["decimals"][boughtId], digitsToShow)} ${contract["tokens"][boughtId]}`;

            // inside a command, event listener, etc.
            const embed = new MessageEmbed()
                .setColor('#FF9A00')
                .setTitle('Withdraw')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], null, `https://etherscan.io/address/${contract["address"]}`)
                .setDescription(`${provider} removed liquidity from the ${contract['name']}`)
                .addFields(
                    { name: 'Withdraw amounts', value: `${withdrawAmounts} ($0)`, inline: false },
                )
                .setTimestamp()
                .setFooter('Some footer text here', 'https://i.imgur.com/wSTFkRM.png');

            send(embed);
            log(JSON.stringify(event));
        });

        // On RemoveLiquidity event
        instance.on("RemoveLiquidityImbalance", (provider, tokenAmounts, fees, invariant, lpTokenSupply, event) => {
            let withdrawAmounts = "";

            const digitsToShow = 4
            for (let i = 0; i < tokenAmounts.length; i++) {
                withdrawAmounts += `${contract["tokens"][i]} ${toHumanString(tokenAmounts[i], contract["decimals"][i], digitsToShow)}, `
            }
            withdrawAmounts = withdrawAmounts.slice(0, -2)

            // inside a command, event listener, etc.
            const embed = new MessageEmbed()
                .setColor('#FF9A00')
                .setTitle('Withdraw')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(contract["name"], null, `https://etherscan.io/address/${contract["address"]}`)
                .setDescription(`${provider} removed liquidity from the ${contract['name']}`)
                .addFields(
                    { name: 'Withdraw amounts', value: `${withdrawAmounts} ($0)`, inline: false },
                )
                .setTimestamp()
                .setFooter('Some footer text here', 'https://i.imgur.com/wSTFkRM.png');

            send(embed);
            log(JSON.stringify(event));
        });
    }

    await bot.login(process.env.DISCORD_BOT_TOKEN);
}

main();