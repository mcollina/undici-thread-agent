'use strict'

const { test } = require('node:test')
const { deepStrictEqual, strictEqual, rejects } = require('node:assert')
const { join } = require('path')
const { Worker } = require('worker_threads')
const { createThreadInterceptor } = require('../')
const { Agent, request } = require('undici')
const { once } = require('events')
const { setTimeout: sleep } = require('timers/promises')
const Fastify = require('fastify')

test('basic', async (t) => {
  const worker = new Worker(join(__dirname, 'fixtures', 'worker1.js'))
  t.after(() => worker.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker)

  const agent = new Agent().compose(interceptor)

  const { statusCode, body } = await request('http://myserver.local', {
    dispatcher: agent,
  })

  strictEqual(statusCode, 200)
  deepStrictEqual(await body.json(), { hello: 'world' })
})

test('two service in a mesh', async (t) => {
  const worker1 = new Worker(join(__dirname, 'fixtures', 'worker1.js'), {
    workerData: { message: 'mesh' },
  })
  t.after(() => worker1.terminate())
  const worker2 = new Worker(join(__dirname, 'fixtures', 'worker2.js'))
  t.after(() => worker2.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker1)
  interceptor.route('myserver2', worker2)

  const agent = new Agent().compose(interceptor)

  const { body } = await request('http://myserver2.local', {
    dispatcher: agent,
  })

  deepStrictEqual(await body.json(), { hello: 'mesh' })
})

test('two service in a mesh, one is terminated with an inflight message', async (t) => {
  const worker1 = new Worker(join(__dirname, 'fixtures', 'worker1.js'), {
    workerData: { message: 'mesh' },
  })
  t.after(() => worker1.terminate())
  const worker2 = new Worker(join(__dirname, 'fixtures', 'worker2.js'))
  t.after(() => worker2.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker1)
  interceptor.route('myserver2', worker2)

  const agent = new Agent().compose(interceptor)

  worker1.terminate()

  const res = await request('http://myserver2.local', {
    dispatcher: agent,
  })

  strictEqual(res.statusCode, 500)
  deepStrictEqual(await res.body.json(), {
    error: 'Internal Server Error',
    message: 'Worker exited',
    statusCode: 500,
  })
})

test('two service in a mesh, one is terminated, then a message is sent', async (t) => {
  const worker1 = new Worker(join(__dirname, 'fixtures', 'worker1.js'), {
    workerData: { message: 'mesh' },
  })
  t.after(() => worker1.terminate())
  const worker2 = new Worker(join(__dirname, 'fixtures', 'worker2.js'))
  t.after(() => worker2.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker1)
  interceptor.route('myserver2', worker2)

  const agent = new Agent().compose(interceptor)

  worker1.terminate()

  await once(worker1, 'exit')
  await sleep(1000)

  const res = await request('http://myserver2.local', {
    dispatcher: agent,
  })

  strictEqual(res.statusCode, 500)
  deepStrictEqual(await res.body.json(), {
    error: 'Internal Server Error',
    message: `No server found for myserver.local in ${worker2.threadId}`,
    statusCode: 500,
  })
})

test('buffer', async (t) => {
  const worker = new Worker(join(__dirname, 'fixtures', 'worker1.js'))
  t.after(() => worker.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker)

  const agent = new Agent().compose(interceptor)

  const { statusCode, body } = await request('http://myserver.local/buffer', {
    dispatcher: agent,
  })

  strictEqual(statusCode, 200)
  deepStrictEqual(Buffer.from(await body.arrayBuffer()), Buffer.from('hello'))
})

test('handle errors from inject', async (t) => {
  const worker = new Worker(join(__dirname, 'fixtures', 'error.js'))
  t.after(() => worker.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker)

  const agent = new Agent().compose(interceptor)

  await rejects(request('http://myserver.local', {
    dispatcher: agent,
  }), new Error('kaboom'))
})

test('pass through with domain', async (t) => {
  const app = Fastify()
  app.get('/', async () => {
    return { hello: 'world' }
  })
  await app.listen({ port: 0 })
  t.after(() => app.close())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })

  const agent = new Agent().compose(interceptor)

  const { statusCode, body } = await request(app.listeningOrigin, {
    dispatcher: agent,
  })

  strictEqual(statusCode, 200)
  deepStrictEqual(await body.json(), { hello: 'world' })
})

test('unwanted headers are removed', async (t) => {
  const worker = new Worker(join(__dirname, 'fixtures', 'worker1.js'))
  t.after(() => worker.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker)

  const agent = new Agent().compose(interceptor)

  const { statusCode, body } = await request('http://myserver.local/echo-headers', {
    headers: {
      'x-foo': 'bar',
      connection: 'keep-alive',
      'transfer-encoding': 'chunked',
    },
    dispatcher: agent,
  })

  strictEqual(statusCode, 200)
  deepStrictEqual(await body.json(), {
    'user-agent': 'lightMyRequest',
    host: 'myserver.local',
    'x-foo': 'bar',
  })
})

test('multiple headers', async (t) => {
  const worker = new Worker(join(__dirname, 'fixtures', 'worker1.js'))
  t.after(() => worker.terminate())

  const interceptor = createThreadInterceptor({
    domain: '.local',
  })
  interceptor.route('myserver', worker)

  const agent = new Agent().compose(interceptor)

  const { statusCode, body, headers } = await request('http://myserver.local/headers', {
    dispatcher: agent,
  })

  strictEqual(statusCode, 200)
  deepStrictEqual(headers['x-foo'], ['bar', 'baz'])
  await body.json()
})
