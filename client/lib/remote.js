/**
 * Calls methods and passes callback functions over a message connection.
 * @param {(error: Error) => void} [onError=console.error]
 * @param {(method: string, data: any) => any} [encode]
 * @param {number} [timeout=120000]
 * @returns {any} Dynamic callable proxy; awaiting it waits for a connection.
 */
export function createRemote(onError = console.error, encode = (method, data) => data, timeout = 120_000) {
  /** @type {((message: any) => void|Promise<void>)|null} */
  let send = null
  /** @type {number} */
  let nextId = 0
  /** @type {Map<number, {resolve: (value?: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>, message?: any}>} */
  const pending = new Map()
  /** @type {Set<{finish: (error?: Error) => void}>} */
  const waiting = new Set()
  /** @type {ReturnType<typeof createCallbackBridge>} */
  const callbacks = createCallbackBridge(message => send(message), error => onError?.(error), timeout)

  /**
   * Settles one pending request and releases its timeout.
   * @param {number} id
   * @param {Error|null|undefined} error
   * @param {any} [data]
   * @returns {void}
   */
  function settle(id, error, data) {
    const request = pending.get(id)
    if (!request) return
    pending.delete(id)
    clearTimeout(request.timer)
    if (error) request.reject(error)
    else request.resolve(data)
  }

  /**
   * Sends a request and rejects it if transport fails.
   * @param {number} id
   * @param {{message?: any}} request
   * @returns {void}
   */
  function post(id, request) {
    try {
      const message = request.message
      delete request.message
      send(message)?.catch(error => settle(id, error))
    } catch (error) {
      settle(id, error)
    }
  }

  /**
   * Calls a remote method with encoded callback references.
   * @param {string} method
   * @param {any[]} args
   * @returns {Promise<any>}
   */
  function call(method, args) {
    const id = ++nextId
    const promise = new Promise((resolve, reject) => {
      if (args.length) args[0] = encode(method, args[0])
      const message = { type: 'request', id, method, args: callbacks.encode(args) }
      const timer = setTimeout(() => settle(id, new Error('Remote call timed out: ' + method)), timeout)
      const request = { message, resolve, reject, timer }
      pending.set(id, request)
      if (send) post(id, request)
    })
    // Existing callers can keep ignoring command results; awaiters still receive rejection.
    promise.catch(error => onError?.(error))
    return promise
  }

  /**
   * Waits for an active connection without recursively awaiting the proxy.
   * @returns {Promise<any>} Connected, non-thenable method proxy.
   */
  function ready() {
    if (send) return Promise.resolve(connectedClient)
    return new Promise((resolve, reject) => {
      const waiter = {
        /**
         * Settles a readiness waiter and cancels its timeout.
         * @param {Error} [error] Connection failure, when present.
         * @returns {void}
         */
        finish(error) {
          waiting.delete(waiter)
          clearTimeout(timer)
          if (error) reject(error)
          else resolve(connectedClient)
        }
      }
      const timer = setTimeout(() => waiter.finish(new Error('Remote connection timed out')), timeout)
      waiting.add(waiter)
    })
  }

  /** Local transport controls exposed alongside the dynamic remote methods. */
  const connection = {
    /**
     * Replaces the remote-call error handler.
     * @param {(error: Error) => void} callback Reports failed remote calls.
     * @returns {void}
     */
    setErrorHandler(callback) { onError = callback },
    /**
     * Attaches a transport, sends queued requests, and resolves readiness waiters.
     * @param {(message: any) => void|Promise<void>} postMessage Sends a message to the remote endpoint.
     * @returns {void}
     */
    connect(postMessage) {
      send = postMessage
      for (const [id, request] of pending) if (request.message) post(id, request)
      for (const waiter of waiting) waiter.finish()
    },
    /**
     * Detaches the transport and rejects pending calls.
     * @param {Error} [error] Explicit failure also rejects readiness waiters; omission allows reconnection.
     * @returns {void}
     */
    disconnect(error) {
      send = null
      const reason = error || new Error('Remote connection closed')
      callbacks.clear(reason)
      // Intentional reloads keep readiness waiters for the replacement port.
      if (error) for (const waiter of waiting) waiter.finish(error)
      for (const id of pending.keys()) settle(id, reason)
    },
    /**
     * Releases a locally registered callback reference.
     * @param {Function} callback Callback no longer needed by the caller.
     * @returns {void}
     */
    release(callback) { callbacks.release(callback) },
    /**
     * Routes a transport envelope to request settlement or callback handling.
     * @param {{data: any}} event Incoming message envelope.
     * @returns {void}
     */
    receive({ data }) {
      if (data?.type === 'response') {
        settle(data.id, data.error ? new Error(data.error) : null, data.data)
      } else if (data) callbacks.receive(data)
    }
  }

  /**
   * Builds a callable proxy for a remote method path.
   * @param {string[]} [path=[]] Method path accumulated by property access.
   * @param {boolean} [awaitable=false] Whether awaiting the proxy should wait for a connection.
   * @returns {any} Callable method-path proxy.
   */
  function proxy(path = [], awaitable = false) {
    return new Proxy(() => {}, {
      /**
       * Resolves local connection helpers or extends a remote method path.
       * @param {Function} target Callable proxy target.
       * @param {string|symbol} method Requested property key.
       * @returns {any} Local helper, nested proxy, or undefined for unsupported properties.
       */
      get(target, method) {
        if (!path.length && Object.hasOwn(connection, method)) return connection[method]
        // Resolve to a non-thenable proxy so Promise assimilation cannot recurse.
        if (method === 'then' && awaitable) return (resolve, reject) => ready().then(resolve, reject)
        // Do not turn awaiting or inspecting the proxy into a remote call.
        if (typeof method !== 'string' || method === 'then') return undefined
        return proxy([...path, method])
      },
      /**
       * Invokes the remote method represented by the proxy path.
       * @param {Function} target Callable proxy target.
       * @param {any} receiver Local call receiver, unused by the remote endpoint.
       * @param {any[]} args Positional method arguments.
       * @returns {Promise<any>} Remote return value.
       */
      apply(target, receiver, args) { return call(path.join('.'), args) }
    })
  }

  /** Non-thenable proxy returned after connection readiness resolves.
   * @type {any}
   */
  const connectedClient = proxy()
  return proxy([], true)
}

/**
 * Keeps callback identities and their asynchronous results local to a connection.
 * @param {(message: any) => void|Promise<void>} send
 * @param {(error: Error) => void} [onError=console.error]
 * @param {number} [timeout=120000]
 * @returns {{encode: Function, decode: Function, receive: Function, release: Function, clear: Function}}
 */
export function createCallbackBridge(send, onError = console.error, timeout = 120_000) {
  /** @type {number} */
  let nextId = 0
  /** @type {number} */
  let generation = 0
  /** @type {WeakMap<Function, number>} */
  let identities = new WeakMap()
  /** @type {Map<number, {callback: Function, version: number}>} */
  const local = new Map()
  /** @type {Map<number, {ref: WeakRef<Function>, version: number}>} */
  const remote = new Map()
  /** @type {Map<number, {resolve: (value?: any) => void, reject: (error: Error) => void, timer: ReturnType<typeof setTimeout>, message?: any}>} */
  const pending = new Map()

  /** Releases the sender's registration after its remote proxy becomes unreachable. */
  const collected = new FinalizationRegistry(({ callback, owner, entry }) => {
    if (owner !== generation || remote.get(callback) !== entry) return
    remote.delete(callback)
    try {
      send({ type: 'release', target: 'local', callback, version: entry.version })?.catch(onError)
    } catch (error) { onError(error) }
  })

  /**
   * Encodes positional values, replacing functions with stable callback identifiers.
   * @param {any[]} args
   * @returns {({value: any}|{callback: number, version: number})[]}
   */
  function encode(args) {
    return args.map(value => {
      if (typeof value !== 'function') return { value }
      let id = identities.get(value)
      if (!id) {
        id = ++nextId
        identities.set(value, id)
        local.set(id, { callback: value, version: 0 })
      }
      return { callback: id, version: ++local.get(id).version }
    })
  }

  /**
   * Settles one remote callback invocation and releases its timeout.
   * @param {number} id
   * @param {Error|null|undefined} error
   * @param {any} [value]
   * @returns {void}
   */
  function settle(id, error, value) {
    const call = pending.get(id)
    if (!call) return
    pending.delete(id)
    clearTimeout(call.timer)
    if (error) call.reject(error)
    else call.resolve(value)
  }

  /**
   * Decodes positional values and reuses proxies for remote callbacks.
   * @param {({value: any}|{callback: number, version: number})[]} args
   * @returns {any[]}
   */
  function decode(args) {
    if (!Array.isArray(args)) throw new Error('Remote arguments must be an array')
    return args.map(argument => {
      if (!argument || typeof argument !== 'object') throw new Error('Invalid remote argument')
      if (!Object.hasOwn(argument, 'callback')) return argument.value
      const callback = argument.callback
      let entry = remote.get(callback)
      let proxy = entry?.ref.deref()
      if (!proxy) {
        if (entry) collected.unregister(entry)
        /** @type {number} */
        const owner = generation
        proxy = (...values) => {
          const id = ++nextId
          const promise = new Promise((resolve, reject) => {
            if (owner !== generation) return reject(new Error('Remote callback connection closed'))
            const timer = setTimeout(() => settle(id, new Error('Remote callback timed out')), timeout)
            pending.set(id, { resolve, reject, timer })
            try {
              send({ type: 'callback', id, callback, args: encode(values) })?.catch(error => settle(id, error))
            } catch (error) {
              settle(id, error)
            }
          })
          promise.catch(onError)
          return promise
        }
        entry = { ref: new WeakRef(proxy), version: argument.version }
        remote.set(callback, entry)
        collected.register(proxy, { callback, owner, entry }, entry)
      }
      entry.version = argument.version
      return proxy
    })
  }

  /**
   * Executes callback requests or settles their returned results.
   * @param {any} data Incoming callback protocol message.
   * @returns {void}
   */
  function receive(data) {
    if (data.type === 'release') {
      if (data.target === 'local') {
        const entry = local.get(data.callback)
        // A callback passed again may still be in transit when the old proxy is collected.
        if (entry?.version === data.version) {
          identities.delete(entry.callback)
          local.delete(data.callback)
        }
      } else {
        const entry = remote.get(data.callback)
        if (entry) collected.unregister(entry)
        remote.delete(data.callback)
      }
    } else if (data.type === 'callback-result') {
      settle(data.id, data.error ? new Error(data.error) : null, data.value)
    } else if (data.type === 'callback') {
      /** @type {number} */
      const owner = generation
      /** Replies only while the originating connection is still active.
       * @param {{value?: any, error?: string}} response
       * @returns {void|Promise<void>}
       */
      const reply = response => {
        if (owner === generation) return send({ type: 'callback-result', id: data.id, ...response })
      }
      Promise.resolve().then(() => {
        const callback = local.get(data.callback)?.callback
        if (!callback) throw new Error('Remote callback was released')
        return callback(...decode(data.args))
      }).then(value => reply({ value }), error => reply({ error: error?.message || String(error) })).catch(onError)
    }
  }

  return {
    encode,
    decode,
    receive,
    /** Releases a locally registered callback.
     * @param {Function} callback
     * @returns {void}
     */
    release(callback) {
      const id = identities.get(callback)
      if (!id) return
      local.delete(id)
      identities.delete(callback)
      try { send({ type: 'release', target: 'remote', callback: id })?.catch(onError) } catch (error) { onError(error) }
    },
    /**
     * Releases callback identities and rejects pending callback invocations.
     * @param {Error} [error]
     * @returns {void}
     */
    clear(error = new Error('Remote callback connection closed')) {
      generation++
      identities = new WeakMap()
      local.clear()
      for (const entry of remote.values()) collected.unregister(entry)
      remote.clear()
      for (const id of pending.keys()) settle(id, error)
    }
  }
}
