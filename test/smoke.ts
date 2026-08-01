import { Context } from '@fraqjs/fraq'
import TakumiPlugin from '@fraqjs/plugin-takumi'
import MasterList from 'fraq-plugin-master'
import 'dotenv/config'

import ExamplePlugin from '../src'

const ctx = Context.fromUrl(process.env.URL!, {
  accessToken: process.env.TOKEN,
  logHandler(message) {
    console.log(`[${message.level}] [${message.module}] ${message.message}`)
  },
})

// If your plugin depends on other plugins, you should install them here as well.
ctx.install(TakumiPlugin)
ctx.install(MasterList)
ctx.install(ExamplePlugin)

ctx.start()

process.on('SIGINT', async () => {
  await ctx.stop()
  process.exit(0)
})
