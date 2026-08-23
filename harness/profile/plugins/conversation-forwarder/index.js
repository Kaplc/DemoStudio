/**
 * Conversation Forwarder Plugin
 * 
 * 将 DSH 对话流通过 WebSocket 实时转发给外部 AI UI
 * 
 * 使用方式：
 * 1. 启动后在 Settings 中配置 WebSocket 端口
 * 2. 外部 AI UI 连接到 ws://localhost:<port> 接收对话消息
 */

// Host 端：WebSocket 服务器 + 对话事件监听
const hostPlugin = {
  apply(ctx) {
    let config = {
      enabled: false,
      port: 8765,
      clients: new Set(),
      server: null,
      forwardedCount: 0,
      lastForwarded: null,
      error: null
    };

    const disposers = [];

    // RPC: 获取配置
    disposers.push(harness.handle('forwarder-get-config', async () => {
      return {
        enabled: config.enabled,
        port: config.port,
        connectedClients: config.clients.size,
        forwardedCount: config.forwardedCount,
        lastForwarded: config.lastForwarded,
        error: config.error
      };
    }));

    // RPC: 更新配置
    disposers.push(harness.handle('forwarder-set-config', async (args) => {
      if (typeof args.enabled === 'boolean') {
        config.enabled = args.enabled;
        if (args.enabled) {
          startServer();
        } else {
          stopServer();
        }
      }
      if (typeof args.port === 'number' && args.port > 0 && args.port < 65536) {
        const needRestart = config.server && config.port !== args.port;
        config.port = args.port;
        if (needRestart) {
          stopServer();
          startServer();
        }
      }
      config.error = null;
      return { ok: true };
    }));

    // 启动 WebSocket 服务器
    async function startServer() {
      if (config.server) return;
      
      try {
        // 使用 Node.js 内置模块
        const http = require('http');
        const { WebSocketServer } = require('ws');

        const server = http.createServer();
        const wss = new WebSocketServer({ server });

        wss.on('connection', (ws) => {
          config.clients.add(ws);
          console.log(`[forwarder] Client connected. Total: ${config.clients.size}`);
          
          // 发送欢迎消息
          ws.send(JSON.stringify({
            type: 'connected',
            message: 'DSH Conversation Forwarder',
            timestamp: new Date().toISOString()
          }));

          ws.on('close', () => {
            config.clients.delete(ws);
            console.log(`[forwarder] Client disconnected. Total: ${config.clients.size}`);
          });

          ws.on('error', (err) => {
            console.error('[forwarder] Client error:', err.message);
            config.clients.delete(ws);
          });
        });

        server.listen(config.port, () => {
          config.server = server;
          config.error = null;
          console.log(`[forwarder] WebSocket server started on ws://localhost:${config.port}`);
        });

        server.on('error', (err) => {
          config.error = err.message;
          console.error('[forwarder] Server error:', err.message);
        });
      } catch (err) {
        config.error = err.message;
        console.error('[forwarder] Failed to start server:', err.message);
      }
    }

    // 停止 WebSocket 服务器
    function stopServer() {
      if (config.server) {
        config.clients.forEach(client => {
          try { client.close(); } catch (e) {}
        });
        config.clients.clear();
        config.server.close();
        config.server = null;
        console.log('[forwarder] WebSocket server stopped');
      }
    }

    // 广播消息给所有客户端
    function broadcast(data) {
      if (config.clients.size === 0) return;
      
      const message = JSON.stringify(data);
      config.clients.forEach(client => {
        try {
          if (client.readyState === 1) { // WebSocket.OPEN
            client.send(message);
          }
        } catch (err) {
          console.error('[forwarder] Broadcast error:', err.message);
          config.clients.delete(client);
        }
      });
      
      config.lastForwarded = new Date().toISOString();
      config.forwardedCount++;
    }

    // 监听对话事件
    disposers.push(ctx.on('session/event', (session, event) => {
      if (!config.enabled || config.clients.size === 0) return;
      
      // 只转发用户消息和助手消息
      if (event.type !== 'user-message' && event.type !== 'assistant-message') return;

      const eventData = {
        type: 'conversation',
        sessionId: session.id,
        seq: event.seq,
        role: event.type === 'user-message' ? 'user' : 'assistant',
        content: [],
        timestamp: new Date().toISOString()
      };

      // 提取文本内容
      if (event.message && event.message.content) {
        for (const block of event.message.content) {
          if (block.type === 'text' && block.text) {
            eventData.content.push({ type: 'text', text: block.text });
          }
        }
      }

      if (eventData.content.length > 0) {
        broadcast(eventData);
      }
    }));

    // 监听 agent 状态变化
    disposers.push(ctx.on('agent/status', (payload) => {
      if (!config.enabled || config.clients.size === 0) return;
      
      broadcast({
        type: 'status',
        agentId: payload.agent?.id,
        status: payload.status,
        timestamp: new Date().toISOString()
      });
    }));

    // 清理
    ctx.effect(() => {
      return () => {
        stopServer();
        disposers.forEach(d => typeof d === 'function' && d());
      };
    });

    console.log('[conversation-forwarder] Host plugin loaded. Configure in Settings.');
  }
};

// Client 端：设置 UI
const clientPlugin = {
  apply(ctx) {
    const slots = ctx.get('slots');
    if (!slots) return;

    let state = {
      enabled: false,
      port: 8765,
      connectedClients: 0,
      forwardedCount: 0,
      lastForwarded: null,
      error: null,
      loading: true
    };
    const subs = new Set();

    function setState(patch) {
      Object.assign(state, patch);
      subs.forEach(fn => fn());
    }

    function useFs() {
      const [s, setL] = React.useState(state);
      React.useEffect(() => {
        const h = () => setL(Object.assign({}, state));
        subs.add(h);
        return () => subs.delete(h);
      }, []);
      return s;
    }

    async function loadCfg() {
      try {
        const c = await host.call('forwarder-get-config', {});
        setState(Object.assign(c, { loading: false }));
      } catch (e) {
        setState({ error: e.message, loading: false });
      }
    }

    async function saveCfg(patch) {
      try {
        await host.call('forwarder-set-config', patch);
        setState(patch);
      } catch (e) {
        setState({ error: e.message });
      }
    }

    // 定时刷新状态
    let refreshTimer = null;
    function startRefresh() {
      if (refreshTimer) return;
      refreshTimer = setInterval(async () => {
        try {
          const c = await host.call('forwarder-get-config', {});
          setState(c);
        } catch (e) {}
      }, 3000);
    }

    function ForwarderSettings() {
      const s = useFs();
      const [editPort, setEditPort] = React.useState(String(s.port || 8765));
      
      React.useEffect(() => {
        loadCfg();
        startRefresh();
        return () => {
          if (refreshTimer) {
            clearInterval(refreshTimer);
            refreshTimer = null;
          }
        };
      }, []);

      if (s.loading) return React.createElement('div', { style: { padding: 16, color: '#888' } }, 'Loading...');

      const h = React.createElement;

      return h('div', { style: { padding: 16, fontFamily: 'system-ui, sans-serif' } },
        // 标题
        h('h3', { style: { margin: '0 0 16px', fontSize: 16 } }, '📡 Conversation Forwarder'),
        
        // 说明
        h('p', { style: { margin: '0 0 16px', fontSize: 13, color: '#666', lineHeight: 1.5 } },
          '将 DSH 对话流通过 WebSocket 实时转发到外部 AI UI。启用后，外部应用可连接到 ',
          h('code', { style: { background: '#f0f0f0', padding: '2px 6px', borderRadius: 3, fontSize: 12 } }, 
            'ws://localhost:' + s.port),
          ' 接收消息。'
        ),

        // 开关
        h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, padding: '12px 16px', background: s.enabled ? '#e8f5e9' : '#f5f5f5', borderRadius: 8 } },
          h('label', { style: { display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', flex: 1 } },
            h('input', {
              type: 'checkbox',
              checked: s.enabled,
              onChange: () => {
                const next = !s.enabled;
                saveCfg({ enabled: next });
              },
              style: { width: 18, height: 18 }
            }),
            h('span', { style: { fontWeight: 500 } }, s.enabled ? '已启用' : '已禁用')
          ),
          s.enabled && h('span', { style: { 
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '4px 10px', background: '#4caf50', color: 'white', 
            borderRadius: 12, fontSize: 11, fontWeight: 500 
          } }, '● 运行中')
        ),

        // 端口配置
        h('div', { style: { marginBottom: 16 } },
          h('label', { style: { display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 500 } }, 'WebSocket 端口'),
          h('div', { style: { display: 'flex', gap: 8 } },
            h('input', {
              type: 'number',
              value: editPort,
              onChange: (e) => setEditPort(e.target.value),
              min: 1024,
              max: 65535,
              style: { flex: 1, padding: '8px 12px', border: '1px solid #ddd', borderRadius: 6, fontSize: 14 }
            }),
            h('button', {
              onClick: () => {
                const port = parseInt(editPort, 10);
                if (port > 0 && port < 65536) saveCfg({ port });
              },
              style: { padding: '8px 16px', background: '#1976d2', color: 'white', border: 'none', borderRadius: 6, cursor: 'pointer', fontSize: 13 }
            }, '应用')
          )
        ),

        // 状态信息
        h('div', { style: { padding: 16, background: '#f8f9fa', borderRadius: 8, fontSize: 13 } },
          h('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 } },
            h('div', null,
              h('div', { style: { color: '#666', fontSize: 11, marginBottom: 4 } }, '连接客户端'),
              h('div', { style: { fontSize: 20, fontWeight: 600, color: s.connectedClients > 0 ? '#4caf50' : '#999' } }, s.connectedClients)
            ),
            h('div', null,
              h('div', { style: { color: '#666', fontSize: 11, marginBottom: 4 } }, '已转发消息'),
              h('div', { style: { fontSize: 20, fontWeight: 600 } }, s.forwardedCount)
            )
          ),
          s.lastForwarded && h('div', { style: { marginTop: 12, color: '#666', fontSize: 12 } },
            '最后转发: ', new Date(s.lastForwarded).toLocaleString()
          ),
          s.error && h('div', { style: { marginTop: 12, color: '#d32f2f', fontSize: 12 } },
            '❌ ', s.error
          )
        ),

        // 使用说明
        h('div', { style: { marginTop: 16, padding: 16, background: '#fff3e0', borderRadius: 8, fontSize: 12, lineHeight: 1.6 } },
          h('div', { style: { fontWeight: 600, marginBottom: 8 } }, '💡 使用方法'),
          h('ol', { style: { margin: 0, paddingLeft: 20 } },
            h('li', null, '启用转发器'),
            h('li', null, '在外部 AI UI 中连接 WebSocket: ',
              h('code', null, 'ws://localhost:' + s.port)),
            h('li', null, '开始对话，消息将自动转发')
          ),
          h('div', { style: { marginTop: 12 } },
            h('div', { style: { fontWeight: 600, marginBottom: 4 } }, '消息格式:'),
            h('pre', { style: { 
              background: '#fff', padding: 12, borderRadius: 4, 
              overflow: 'auto', fontSize: 11, margin: 0,
              border: '1px solid #eee'
            } }, JSON.stringify({ type: 'conversation', role: 'user', content: [{ type: 'text', text: '...' }] }, null, 2))
          )
        )
      );
    }

    // 注册设置页面
    var disposer = slots.inject('settings.section', function() {
      slots.register(
        { name: 'settings.section', id: 'conversation-forwarder', order: 90, label: 'Forwarder' },
        function() { return React.createElement(ForwarderSettings); }
      );
    });
    ctx.effect(function() { return disposer; });

    console.log('[conversation-forwarder] Client UI registered');
  }
};

module.exports = { hostPlugin, clientPlugin };
