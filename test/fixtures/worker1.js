'use strict'

const { Readable } = require('stream')
const { parentPort, workerData, threadId } = require('worker_threads')
const fastify = require('fastify')
const { wire } = require('../../')
const fastifyStatic = require('@fastify/static')
const { join } = require('path')
const { setTimeout: sleep } = require('timers/promises')

const app = fastify()

app.register(fastifyStatic, {
  root: join(__dirname, 'public'),
  prefix: '/public',
})

app.get('/', (req, reply) => {
  reply.send({ hello: workerData?.message || 'world' })
})

app.get('/whoami', (req, reply) => {
  if (workerData?.whoamiReturn503) {
    return reply.code(503).send({ threadId })
  }
  reply.send({ threadId })
})

app.get('/buffer', (req, reply) => {
  reply.send(Buffer.from('hello'))
})

app.get('/echo-headers', (req, reply) => {
  reply.send(req.headers)
})

app.get('/headers', (req, reply) => {
  reply
    .header('x-foo', ['bar', 'baz'])
    .send({ hello: 'world' })
})

app.get('/no-headers', (req, reply) => {
  reply.send(Readable.from(['text'], { objectMode: false }))
})

app.post('/echo-body', (req, reply) => {
  reply.send(req.body)
})

app.get('/long', async (req, reply) => {
  await sleep(1000)
  return { hello: 'world' }
})

wire({ server: app, port: parentPort })
