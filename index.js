// Dependencies
const dotenv = require('dotenv');
const { Client, Intents, MessageEmbed } = require('discord.js');
const { ethers, Contract, BigNumber } = require("ethers");
const publicIp = require('public-ip');
const swapABI = require('./constants/swapABI.json');
const contracts = require('./constants/localContracts.json');

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
    let s = BigNumber.from(rawTokenAmount).div(decimals - digitsToShow).toString();
    return s.slice(0, -digitsToShow) + "." + s.slice(-digitsToShow);
}

async function main() {
    bot.on('ready', async () => {
        console.log(`Logged in as ${bot.user.tag}!`);
        await log(`Bot started at ${await publicIp.v4()}. Using ${process.env.ALCHEMY_API} as the json rpc endpoint.`)
    });

    bot.on('message', msg => {
        if (msg.content === 'ping') {
            send('pong');
        }
    });

    for (const contract of contracts) {
        const instance = new Contract(contract.address, swapABI, provider)

        instance.on("TokenSwap", (buyer, tokensSold, tokensBought, soldId, boughtId, event) => {
            const soldTokenName = contract.tokens[soldId]
            const boughtTokenName = contract.tokens[boughtId]

            const digitsToShow = 4

            const numOfTokenSold = toHumanString(tokensSold, contract.decimals[soldId], digitsToShow)
            const numOfTokenBought = toHumanString(tokensBought, contract.decimals[boughtId], digitsToShow)

            // inside a command, event listener, etc.
            const embed = new MessageEmbed()
                .setColor('#0099ff')
                .setTitle('Token swap')
                .setURL(`https://etherscan.io/tx/${event.transactionHash}`)
                .setAuthor(buyer, null, `https://etherscan.io/address/${buyer}`)
                .setDescription(`Swapped ${soldTokenName} to ${boughtTokenName}`)
                .addFields(
                    { name: 'Input amount', value: `${numOfTokenSold} ${soldTokenName} ($0)`, inline: true },
                    { name: 'Output amount', value: `${numOfTokenBought} ${boughtTokenName} ($0)`, inline: true },
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