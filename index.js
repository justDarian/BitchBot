const Discord = require('discord.js-selfbot-v13')
const axios = require('axios')
const fs = require('fs')
const path = require('path')
const util = require('util');

const configPath = path.join(__dirname, 'config.json')
const cachePath = path.join(__dirname, 'sessionCache.json')

sessionCache = JSON.parse(fs.readFileSync(cachePath, 'utf8'))

function addSessionToCache(sessionId) {
    const oneDayMs = 24 * 60 * 60 * 1000
    if (Date.now() - sessionCache.lastUpdated > oneDayMs) {
        sessionCache = {
            lastUpdated: Date.now(),
            sessionIds: []
        }
    }

    if (!sessionCache.sessionIds.includes(sessionId)) {
        sessionCache.sessionIds.push(sessionId)
        sessionCache.lastUpdated = Date.now()
        fs.writeFileSync(cachePath, JSON.stringify(sessionCache, null, 2), 'utf8')
    }
}

let config = {}
if (fs.existsSync(configPath)) {
    try {
        config = JSON.parse(fs.readFileSync(configPath, 'utf8'))

        if (!config.applicationId) {
            console.log('applicationId is missing in config')
            process.exit(1)
        }
    } catch (err) {
        console.log(err)
    }
}

function saveConfig() {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

const prefix = config.prefix
const commands = new Map()

const client = new Discord.Client({

})

function createCommand(name, callback) {
    commands.set(name, callback)
}

client.on('ready', () => {
    console.log(`${client.user.username} is ready`)

    addSessionToCache(client.sessionId)

    rpcEnabled = config.rpcEnabled

    if (config.rpcEnabled && config.currentRPC) {
        const preset = loadPreset(config.currentRPC)
        if (preset) {
            setRPC(preset)
            console.log(`Restored RPC: ${preset.name}`)
        } else {
            console.log(`Failed to restore RPC: ${config.currentRPC} not found`)
            config.currentRPC = null
            config.rpcEnabled = false
            rpcEnabled = false
            saveConfig()
        }
    }

    setInterval(checkOfflineStatus, 5000)
})

client.on('messageCreate', async message => {
    if (message.author.id !== client.user.id) return
    if (!message.content.startsWith(prefix)) return

    const args = message.content.slice(prefix.length).trim().split(/ +/)
    const command = args.shift().toLowerCase()

    if (commands.has(command)) {
        try {
            message.delete()
            await commands.get(command)(message, args)
            console.log(`ran command: ${command}`)
        } catch (err) {
            console.log(err)
        }
    }
})

const rpcDir = path.join(__dirname, 'rpc')
let activeRPC = null
let rpcEnabled = config.rpcEnabled
let isCurrentlyOffline = false

if (!fs.existsSync(rpcDir)) {
    fs.mkdirSync(rpcDir, {
        recursive: true
    })
}

function getPresetList() {
    return fs.readdirSync(rpcDir)
        .filter(file => file.endsWith('.json'))
        .map(file => ({
            name: path.basename(file, '.json'),
            path: path.join(rpcDir, file)
        }))
}

function loadPreset(name) {
    const presetPath = path.join(rpcDir, `${name}.json`)
    if (!fs.existsSync(presetPath)) return null

    try {
        const data = fs.readFileSync(presetPath, 'utf8')
        return JSON.parse(data)
    } catch (err) {
        return null
    }
}

function savePreset(name, data) {
    const presetPath = path.join(rpcDir, `${name}.json`)
    fs.writeFileSync(presetPath, JSON.stringify(data, null, 2), 'utf8')
}

function deletePreset(name) {
    const presetPath = path.join(rpcDir, `${name}.json`)
    if (fs.existsSync(presetPath)) {
        fs.unlinkSync(presetPath)
        return true
    }
    return false
}

// bro this is so annoying
async function setRPC(preset) {
    if (!preset) {
        await client.user.setActivity(null)
        activeRPC = null
        return
    }

    try {
        let largeImageExternal = null;
        let smallImageExternal = null;

        if (preset.assets) {
            // fuck you discord, thanks
            if (preset.assets.large_image && preset.assets.large_image.startsWith('http')) {
                const largeExternalAssets = await Discord.RichPresence.getExternal(
                    client,
                    config.applicationId,
                    preset.assets.large_image
                );
                if (largeExternalAssets && largeExternalAssets.length > 0) {
                    largeImageExternal = largeExternalAssets[0].external_asset_path;
                }
            }

            if (preset.assets.small_image && preset.assets.small_image.startsWith('http')) {
                const smallExternalAssets = await Discord.RichPresence.getExternal(
                    client,
                    config.applicationId,
                    preset.assets.small_image
                );
                if (smallExternalAssets && smallExternalAssets.length > 0) {
                    smallImageExternal = smallExternalAssets[0].external_asset_path;
                }
            }
        }

        const rpc = new Discord.RichPresence(client)
            .setApplicationId(config.applicationId)
            .setName(preset.name)
            .setType(preset.type || 0)

        if (preset.details) rpc.setDetails(preset.details)
        if (preset.state) rpc.setState(preset.state)

        if (preset.timestamps) {
            if (preset.timestamps.start === "now") {
                rpc.setStartTimestamp(Date.now())
            } else if (preset.timestamps.start) {
                rpc.setStartTimestamp(preset.timestamps.start)
            }

            if (preset.timestamps.end) {
                rpc.setEndTimestamp(preset.timestamps.end)
            }
        }

        if (preset.assets) {
            if (largeImageExternal) {
                rpc.setAssetsLargeImage(largeImageExternal)
            } else if (preset.assets.large_image) {
                rpc.setAssetsLargeImage(preset.assets.large_image)
            }

            if (preset.assets.large_text) {
                rpc.setAssetsLargeText(preset.assets.large_text)
            }

            if (smallImageExternal) {
                rpc.setAssetsSmallImage(smallImageExternal)
            } else if (preset.assets.small_image) {
                rpc.setAssetsSmallImage(preset.assets.small_image)
            }

            if (preset.assets.small_text) {
                rpc.setAssetsSmallText(preset.assets.small_text)
            }
        }

        if (preset.buttons && preset.buttons.length > 0) {
            preset.buttons.forEach(button => {
                rpc.addButton(button.label, button.url)
            })
        }

        await client.user.setActivity(rpc)
        activeRPC = preset
    } catch (error) {
        console.log( error)
        await client.user.setActivity(null)
    }
}

// RPC Commands
createCommand('rpc', async (message) => {
    const presets = getPresetList()
    if (presets.length === 0) {
        const msg = await message.channel.send('no RPC presets found')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const presetList = presets.map(p => p.name).join(', ')

    const rpcCommands = Array.from(commands.keys())
        .filter(cmd => cmd.startsWith('rpc'))
        .map(cmd => `${prefix}${cmd}`)
        .join(', ')

    const msg = await message.channel.send(`RPC status: ${rpcEnabled ? 'enabled' : 'disabled'}
${ activeRPC ? `active: ${activeRPC.name}` : 'nothing' }
available presets: ${presetList}

RPC commands: ${rpcCommands}`)
    setTimeout(() => msg.delete().catch(() => {}), 7000)
})

createCommand('rpcset', async (message, args) => {
    if (!args[0]) {
        const msg = await message.channel.send('usage: .rpcset <presetName>')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const preset = loadPreset(args[0])
    if (!preset) {
        const msg = await message.channel.send(`preset "${args[0]}" not found`)
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    try {
        rpcEnabled = true
        config.rpcEnabled = true
        config.currentRPC = args[0]
        saveConfig()
        await setRPC(preset)

        const msg = await message.channel.send(`rpc set to "${args[0]}"`)
        setTimeout(() => msg.delete().catch(() => {}), 2000)
    } catch (error) {
        console.log(error)
        const msg = await message.channel.send(`E${error.message}`)
        setTimeout(() => msg.delete().catch(() => {}), 3000)
    }
})

createCommand('rpctoggle', async (message) => {
    rpcEnabled = !rpcEnabled
    config.rpcEnabled = rpcEnabled

    if (rpcEnabled && activeRPC) {
        await setRPC(activeRPC)
        const msg = await message.channel.send('rpc enabled')
        setTimeout(() => msg.delete().catch(() => {}), 2000)
    } else if (rpcEnabled && config.currentRPC) {
        const preset = loadPreset(config.currentRPC)
        if (preset) {
            await setRPC(preset)
            const msg = await message.channel.send('rpc enabled')
            setTimeout(() => msg.delete().catch(() => {}), 2000)
        } else {
            const msg = await message.channel.send('no rpc preset configured')
            setTimeout(() => msg.delete().catch(() => {}), 2000)
        }
    } else if (!rpcEnabled) {
        await client.user.setActivity(null)
        const msg = await message.channel.send('rpc disabled')
        setTimeout(() => msg.delete().catch(() => {}), 2000)
    } else {
        const msg = await message.channel.send('no rpc preset configured')
        setTimeout(() => msg.delete().catch(() => {}), 2000)
    }

    saveConfig()
})

createCommand('rpcadd', async (message) => {
    if (message.attachments.size === 0) {
        const msg = await message.channel.send('please attach a JSON config file')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const attachment = message.attachments.first()
    if (!attachment.name.endsWith('.json')) {
        const msg = await message.channel.send('please attach a JSON file')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    try {
        const response = await axios.get(attachment.url)
        const preset = response.data

        if (!preset.name) {
            const msg = await message.channel.send('invalid preset: missing name property')
            setTimeout(() => msg.delete().catch(() => {}), 3000)
            return
        }

        const safeName = preset.name.toLowerCase().replace(/[^a-z0-9_-]/g, '_')
        savePreset(safeName, preset)

        const msg = await message.channel.send(`added preset "${preset.name}" as ${safeName}.json`)
        setTimeout(() => msg.delete().catch(() => {}), 3000)
    } catch (error) {
        const msg = await message.channel.send(`error processing file: ${error.message}`)
        setTimeout(() => msg.delete().catch(() => {}), 3000)
    }
})

createCommand('rpcdelete', async (message, args) => {
    if (!args[0]) {
        const msg = await message.channel.send('usage: .rpcdelete <preset_name>')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const name = args[0];
    if (!loadPreset(name)) {
        const msg = await message.channel.send(`preset "${name}" not found`)
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const confirm = async text => {
        const msg = await message.channel.send(text)
        try {
            const collected = await message.channel.awaitMessages({
                filter: m => m.author.id === message.author.id,
                max: 1,
                time: 10000
            })
            const reply = collected.first()
            const result = reply.content.toLowerCase() === 'yes'
            reply.delete().catch(() => {})
            msg.delete().catch(() => {})
            return result
        } catch {
            msg.delete().catch(() => {})
            return false
        }
    }

    if (!(await confirm('you sure?')) || !(await confirm('positive?'))) {
        message.channel.send('Deletion canceled').then(m =>
            setTimeout(() => m.delete().catch(() => {}), 3000)
        )
        return
    }

    deletePreset(name)
    if (activeRPC?.name.toLowerCase() === name.toLowerCase()) {
        await setRPC(null)
        activeRPC = null
    }

    message.channel.send(`preset "${name}" has been deleted`).then(m =>
        setTimeout(() => m.delete().catch(() => {}), 3000)
    )
})

createCommand('rpcget', async (message, args) => {
    if (!args[0]) {
        const msg = await message.channel.send('usage: .rpcget <preset_name>')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const presetName = args[0]
    const presetPath = path.join(rpcDir, `${presetName}.json`)

    if (!fs.existsSync(presetPath)) {
        const msg = await message.channel.send(`preset "${presetName}" not found`)
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    await message.channel.send({
        content: `"${presetName}" preset`,
        files: [{
            attachment: presetPath,
            name: `${presetName}.json`
        }]
    })
})

createCommand('help', async message => {
    const msg = await message.channel.send('available commands: ' + Array.from(commands.keys()).join(', '))
    setTimeout(async () => {
        try {
            await msg.delete()
        } catch {}
    }, 2000);
})

createCommand('ping', async message => {
    const sent = await message.channel.send('ping..')
    sent.edit(`ping: ${sent.createdTimestamp - message.createdTimestamp}ms`)
})

createCommand('nuke', async message => {
    if (!message.guild) {
        return message.channel.send('can only be used in servers')
    }
    const channel = message.channel
    const perms = channel.permissionsFor(client.user)

    if (!perms || !perms.has('ManageChannels')) {
        return message.channel.send('missing server permissions')
    }

    const position = channel.position
    const cloned = await channel.clone()

    await channel.delete()
    await cloned.setPosition(position)
})

createCommand('rat', async (message, args) => {
    const target = args[0]
    if (!target) return message.channel.send('usage: .rat @user or userID')

    const spacing = '\u200b\n'.repeat(200)
    const mention = target.startsWith('<@') ? target : `<@${target}>`
    const steps = [
        `Connecting to ${mention}`,
        `Bypassing the firewall..`,
        `Hacking into the mainframe...`,
        `${mention}'s IP has been resolved`
    ]

    function randomizeText(base) {
        const chars = 'AaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPpQqRrSsTtUuVvWwXxYyZz0123456789'
        const pad = () => Array(9).fill().map(() => chars[Math.floor(Math.random() * chars.length)]).join('')
        return `${pad()} | ${base} | ${pad()}`
    }

    const msg = await message.channel.send(spacing + randomizeText(steps[0]))

    for (let i = 0; i < steps.length; i++) {
        await msg.edit(spacing + randomizeText(steps[i]))

        for (let j = 0; j < 3; j++) {
            await new Promise(resolve => setTimeout(resolve, 500))
            await msg.edit(spacing + randomizeText(steps[i]))
        }

        if (i < steps.length - 1) {
            await new Promise(resolve => setTimeout(resolve, 2000))
        }
    }

    try {
        await msg.delete()
    } catch {}
})

let stopPurging = false

createCommand('stop', async message => {
    stopPurging = true
})

createCommand('purge', async (message, args) => {
    const amount = parseInt(args[0])
    if (isNaN(amount) || amount < 1) return message.channel.send('invalid number')
    const targetArg = args[1]
    const target = targetArg ? (targetArg.startsWith('<@') ? targetArg.replace(/[<@!>]/g, '') : targetArg) : null
    const canDeleteOthers = message.guild ?
        message.channel.permissionsFor(client.user)?.has('ManageMessages') :
        false
    stopPurging = false

    let deleted = 0
    let failed = 0

    const status = await message.channel.send('starting')

    try {
        let lastId = null
        let remaining = amount

        while (remaining > 0 && !stopPurging) {
            const options = {
                limit: 100
            }
            if (lastId) options.before = lastId

            const messages = await message.channel.messages.fetch(options)
            if (messages.size === 0) break

            lastId = messages.last().id

            const filteredMessages = messages.filter(msg => {
                if (msg.id === status.id) return false
                if (target && msg.author.id !== target) return false
                if (!target && !canDeleteOthers && msg.author.id !== client.user.id) return false
                return true
            })

            const toDelete = Array.from(filteredMessages.values()).slice(0, remaining)
            remaining -= toDelete.length

            if (deleted % 20 === 0 || deleted === 0) {
                await status.edit('deleting messages..')
            }

            for (const msg of toDelete) {
                if (stopPurging) break

                try {
                    await msg.delete()
                    deleted++
                } catch {
                    failed++
                }

                // idk
                await new Promise(r => setTimeout(r, 10))
            }

            if (target && filteredMessages.size === 0) continue
        }

        try {
            await status.edit(`done deleted: ${deleted}, errors: ${failed}`)
        } catch {}
    } catch (error) {
        console.log(error)
        await status.edit(`error: ${error.message}`)
    }
})

// fuckass discord bro
client.on("ready", () => {
    const originalHandlePacket = client.ws.handlePacket.bind(client.ws);

    client.ws.handlePacket = (packet, shard) => {
        if (typeof packet === "object" && packet?.t === "SESSIONS_REPLACE") {
            const sessions = packet.d || [];
            const ownSessionId = client.sessionId;
            const seen = new Set();

            client.currentSessions = sessions.filter(session => {
                const sessionId = session.session_id;
                const isNotOwn = sessionId !== ownSessionId;
                const isNotCached = !sessionCache.sessionIds.includes(sessionId);
                const isKnownClient = session.client_info?.client !== "unknown";
                const isUnique = !seen.has(sessionId);

                if (isNotOwn && isNotCached && isKnownClient && isUnique) {
                    seen.add(sessionId);
                    return true;
                }

                return false;
            });

            //console.log(client.currentSessions)
        }

        return originalHandlePacket(packet, shard);
    };
});

async function checkOfflineStatus() {
    if (!client.user) return

    const hasActiveSessions = client.currentSessions && client.currentSessions.length > 0
    const shouldBeOffline = !hasActiveSessions

    if (shouldBeOffline && !isCurrentlyOffline) {
        if (config.offline?.enabled) {
            const offlineActivity = {
                name: config.offline.customStatus || '',
                type: 4
            }

            await client.user.setPresence({
                status: config.offline.status || 'dnd',
                activities: [offlineActivity]
            })
        } else {
            await client.user.setPresence({
                status: 'invisible',
                activities: []
            })
        }

        isCurrentlyOffline = true
        activeRPC = null
    } else if (!shouldBeOffline && isCurrentlyOffline) {
        if (rpcEnabled && config.currentRPC) {
            const preset = loadPreset(config.currentRPC)
            if (preset) {
                await setRPC(preset)
            } else {
                await client.user.setActivity(null)
                await client.user.setPresence({
                    status: 'online'
                })
            }
        } else {
            await client.user.setActivity(null)
            await client.user.setPresence({
                status: 'online'
            })
        }

        isCurrentlyOffline = false
    }
}

createCommand('offline', async (message, args) => {
    if (args.length < 1) {
        const mode = config.offline?.status || 'dnd'
        const status = config.offline?.customStatus || '[none]'

        const msg = await message.channel.send(
            `enabled: ${config.offline?.enabled}\n` +
            `settings: ${mode} - "${status}"\n\n` +
            `usage: .offline <mode> <status>\n` +
            `modes: dnd, idle, online`
        )
        setTimeout(() => msg.delete().catch(() => {}), 5000)
        return
    }

    if (args.length < 2) {
        const msg = await message.channel.send('usage: .offline <mode> <status>\nmode: dnd, idle, online')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const mode = args[0].toLowerCase()
    const status = args.slice(1).join(' ')

    if (!['dnd', 'idle', 'online'].includes(mode)) {
        const msg = await message.channel.send('invalid mode. use: dnd, idle, or online')
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    config.offline = {
        enabled: config.offline?.enabled || false,
        status: mode,
        customStatus: status
    }
    saveConfig()

    const msg = await message.channel.send(`offline mode configured: ${mode} - "${status}"`)
    setTimeout(() => msg.delete().catch(() => {}), 2000)
})

createCommand('offlinetoggle', async (message) => {
    if (!config.offline) {
        config.offline = {
            enabled: false,
            status: 'dnd',
            customStatus: ''
        }
    }

    config.offline.enabled = !config.offline.enabled
    saveConfig()

    if (!config.offline.enabled && isCurrentlyOffline) {
        if (rpcEnabled && config.currentRPC) {
            const preset = loadPreset(config.currentRPC)
            if (preset) {
                await setRPC(preset)
            } else {
                await client.user.setActivity(null)
                await client.user.setPresence({
                    status: 'online'
                })
            }
        } else {
            await client.user.setActivity(null)
            await client.user.setPresence({
                status: 'online'
            })
        }
        isCurrentlyOffline = false
    }

    const status = config.offline.enabled ? 'enabled' : 'disabled'
    const msg = await message.channel.send(`offline mode ${status}`)
    setTimeout(() => msg.delete().catch(() => {}), 2000)
})

// bad idea
createCommand("eval", async (message, args) => {
    let code = args.join(" ")
    if (!code) {
        const msg = await message.channel.send("usage: .eval <code>")
        setTimeout(() => msg.delete().catch(() => {}), 3000)
        return
    }

    const match = code.match(/```(?:js|javascript)?\n?([\s\S]*?)\n?```/)
    if (match) {
        code = match[1]
    }

    try {
        code = decodeURIComponent(code)
    } catch {}

    code = `(async () => { ${code} })()`
    console.log(code)

    try {
        let result = eval(code);

        if (result instanceof Promise) {
            result = await result;
        }

        let output = typeof result === 'string' ? result : util.inspect(result, {
            depth: 2,
            colors: false
        });
        const msg = await message.channel.send("```js\n" + output + "\n```");
        setTimeout(() => msg.delete().catch(() => {}), 5000)
    } catch (error) {
        const msg = await message.channel.send("```js\n" + error.stack || error.toString() + "\n```");
        setTimeout(() => msg.delete().catch(() => {}), 5000)
    }
})

client.login(config.token)