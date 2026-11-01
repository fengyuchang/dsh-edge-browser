// Runs inside the existing Harness client plugin factory; no second browser controller.
// Conversation titles follow dsh-doyourweb's MIT design; see LICENSE.dsh-doyourweb.txt.
// This bridge supplies display labels only. The server routes by browser ownership.
function dshRegisterAnnotationClient(ctx) {
  const clientId = crypto.randomUUID();
  let revision = 0;
  const publish = async (targetId, active) => {
    try {
      const summary = ctx.sessions.list.getSnapshot().byId[targetId];
      const response = await fetch('/bsk-observation/annotations/client', {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-dsh-browser-client': clientId },
        body: JSON.stringify({ revision: ++revision, targetId, active, title: summary?.displayTitle || summary?.title || '当前聊天' }),
        keepalive: true
      });
      if (!response.ok) console.warn('DeepSeek browser annotation: selected conversation could not be synchronized', response.status);
    } catch (error) { console.warn('DeepSeek browser annotation: conversation synchronization failed', error); }
  };
  function SelectedConversation({ sessionId }) {
    react.useEffect(() => {
      let busy = false;
      const update = async () => { if (busy) return; busy = true; try { await publish(sessionId, true); } finally { busy = false; } };
      void update();
      const timer = setInterval(update, 2000);
      window.addEventListener('focus', update);
      const inactive = () => { void publish(sessionId, false); };
      window.addEventListener('pagehide', inactive);
      return () => { clearInterval(timer); window.removeEventListener('focus', update); window.removeEventListener('pagehide', inactive); inactive(); };
    }, [sessionId]);
    return null;
  }
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'bsk-annotation-selected-conversation',
    inject: sessionId => ({ sessionId })
  }, SelectedConversation));
}
