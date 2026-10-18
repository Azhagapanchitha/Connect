import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, KeyboardAvoidingView, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '../alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useHeaderHeight } from '@react-navigation/elements';
import { Ionicons } from '@expo/vector-icons';
import { api } from '../api';
import { useAuth, useSocketEvent } from '../AuthContext';
import { Button, Card, Input } from '../components/ui';
import CallPanel from '../components/CallPanel';
import ClientPanel from '../components/Jathagam';
import { colors, money, ROLE, signLabel, STATUS_LABEL } from '../theme';

const isCustomer = ROLE === 'customer';

function useElapsed(startedAt, running) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running]);
  if (!startedAt) return '00:00';
  const secs = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  return `${String(Math.floor(secs / 60)).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
}

function ReviewForm({ session, onDone }) {
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      await api(`/sessions/${session.id}/review`, { method: 'POST', body: { rating, comment } });
      onDone();
    } catch (e) {
      Alert.alert('Could not submit review', e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card style={{ margin: 16 }}>
      <Text style={{ fontWeight: '700', fontSize: 16, color: colors.text, marginBottom: 10 }}>Rate {session.astrologer?.name}</Text>
      <View style={{ flexDirection: 'row', marginBottom: 12 }}>
        {[1, 2, 3, 4, 5].map((i) => (
          <Pressable key={i} onPress={() => setRating(i)} hitSlop={6}>
            <Ionicons name={rating >= i ? 'star' : 'star-outline'} size={32} color={colors.accent} style={{ marginRight: 6 }} />
          </Pressable>
        ))}
      </View>
      <Input placeholder="Share your experience (optional)" value={comment} onChangeText={setComment} multiline />
      <Button title="Submit review" onPress={submit} loading={busy} disabled={!rating} />
    </Card>
  );
}

export default function ChatScreen({ route, navigation }) {
  const { sessionId } = route.params;
  const { user, socket } = useAuth();
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const [typing, setTyping] = useState(false);
  const [showChart, setShowChart] = useState(true);
  const headerHeight = useHeaderHeight();
  const listRef = useRef(null);
  const typingTimer = useRef(null);
  const lastTypingSent = useRef(0);

  useEffect(() => {
    Promise.all([api(`/sessions/${sessionId}`), api(`/sessions/${sessionId}/messages`)])
      .then(([sess, msgs]) => { setSession(sess); setMessages(msgs); })
      .catch((e) => Alert.alert('Error', e.message));
  }, [sessionId]);

  useSocketEvent('session:update', useCallback((sess) => {
    if (sess.id !== sessionId) return;
    setSession(sess);
    if (sess.status === 'ended' && sess.endReason === 'insufficient_balance') {
      Alert.alert('Chat ended', isCustomer ? 'Your wallet balance ran out. Recharge to continue.' : "The client's balance ran out.");
    }
  }, [sessionId]));

  useSocketEvent('message:new', useCallback((m) => {
    if (m.sessionId !== sessionId) return;
    setMessages((prev) => (prev.some((x) => x.id === m.id) ? prev : [...prev, m]));
    setTyping(false);
  }, [sessionId]));

  useSocketEvent('typing', useCallback(({ sessionId: sid }) => {
    if (sid !== sessionId) return;
    setTyping(true);
    clearTimeout(typingTimer.current);
    typingTimer.current = setTimeout(() => setTyping(false), 2500);
  }, [sessionId]));

  const other = session ? (isCustomer ? session.astrologer : session.customer) : null;
  const active = session?.status === 'active';
  const isCall = session?.kind === 'call';
  const elapsed = useElapsed(session?.startedAt, active);

  async function endChat() {
    const verb = session.status === 'requested' ? 'Cancel this request?' : isCall ? 'End this call?' : 'End this chat?';
    Alert.alert(verb, undefined, [
      { text: 'No', style: 'cancel' },
      { text: 'Yes', style: 'destructive', onPress: () => api(`/sessions/${sessionId}/end`, { method: 'POST' }).then(setSession).catch((e) => Alert.alert('Error', e.message)) },
    ]);
  }

  useLayoutEffect(() => {
    navigation.setOptions({
      title: other?.name || 'Chat',
      headerRight: () => (session && ['active', 'requested'].includes(session.status) ? (
        <Pressable onPress={endChat} hitSlop={8}><Text style={{ color: colors.danger, fontWeight: '700' }}>{session.status === 'active' ? 'End' : 'Cancel'}</Text></Pressable>
      ) : null),
    });
  });

  function send() {
    const body = text.trim();
    if (!body || !socket) return;
    setText('');
    socket.emit('message:send', { sessionId, text: body }, (res) => {
      if (!res?.ok) { Alert.alert('Not sent', res?.error || 'Try again'); setText(body); }
    });
  }

  function onChangeText(v) {
    setText(v);
    if (socket && Date.now() - lastTypingSent.current > 1500) {
      lastTypingSent.current = Date.now();
      socket.emit('typing', { sessionId });
    }
  }

  async function respond(action) {
    try { setSession(await api(`/sessions/${sessionId}/${action}`, { method: 'POST' })); } catch (e) { Alert.alert('Error', e.message); }
  }

  if (!session) return <ActivityIndicator style={{ flex: 1 }} color={colors.primary} />;

  return (
    <SafeAreaView edges={['bottom']} style={{ flex: 1, backgroundColor: colors.bg }}>
      {/* Android is edge-to-edge on this Expo SDK and no longer resizes for the keyboard, so pad on both platforms. */}
      <KeyboardAvoidingView behavior="padding" keyboardVerticalOffset={headerHeight} style={{ flex: 1 }}>
        <View style={s.bar}>
          <Text style={s.barText}>
            <Text style={{ fontWeight: '700' }}>{STATUS_LABEL[session.status]}</Text>
            {session.status === 'active' || session.status === 'ended' ? `  ·  ${active ? elapsed : `${session.billedMinutes} min`}` : ''}
            {`  ·  ${money(session.ratePerMin)}/min`}
          </Text>
          <Text style={s.barText}>
            {isCustomer ? `Wallet ${money(user.wallet)}` : `Earned ${money(session.astrologerEarning)}`}
          </Text>
        </View>

        {!isCustomer ? (
          <>
            {showChart ? <View style={s.half}><ClientPanel sessionId={sessionId} customer={session.customer} /></View> : null}
            <Pressable onPress={() => setShowChart((v) => !v)} style={s.toggle}>
              <Text style={s.toggleText}>{showChart ? 'Hide client chart' : 'Show client chart'}</Text>
              <Ionicons name={showChart ? 'chevron-up' : 'chevron-down'} size={16} color={colors.primaryDark} />
            </Pressable>
          </>
        ) : null}

        <View style={s.half}>
          {session.status === 'requested' ? (
            <View style={s.center}>
              {isCustomer ? (
                <>
                  <ActivityIndicator size="large" color={colors.primary} />
                  <Text style={s.centerTitle}>Waiting for {other?.name} to accept…</Text>
                  <Text style={s.centerSub}>Requests expire after 1 minute. You are charged only once the chat starts.</Text>
                </>
              ) : (
                <>
                  <Text style={s.centerTitle}>{other?.name} wants {isCall ? 'a voice call' : 'to chat'}</Text>
                  {session.topic ? <Text style={s.centerSub}>Topic: {session.topic}</Text> : null}
                  <View style={{ flexDirection: 'row', marginTop: 20 }}>
                    <Button title="Decline" variant="danger" onPress={() => respond('reject')} style={{ marginRight: 12, flex: 1 }} />
                    <Button title="Accept" icon="checkmark" onPress={() => respond('accept')} style={{ flex: 1 }} />
                  </View>
                </>
              )}
            </View>
          ) : isCall && active ? (
            <CallPanel sessionId={sessionId} other={other} live={active} elapsed={elapsed} onEnd={endChat} />
          ) : (
            <FlatList
              ref={listRef}
              data={messages}
              keyExtractor={(m) => m.id}
              contentContainerStyle={{ padding: 16 }}
              onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
            onLayout={() => listRef.current?.scrollToEnd({ animated: false })}
              ListEmptyComponent={active ? <Text style={[s.centerSub, { marginTop: 40 }]}>Say hello 👋 The chat is live.</Text> : null}
              renderItem={({ item }) => {
                const mine = item.senderId === user.id;
                return (
                  <View style={[s.bubble, mine ? s.mine : s.theirs]}>
                    <Text style={{ color: mine ? '#fff' : colors.text, fontSize: 15, lineHeight: 21 }}>{item.text}</Text>
                    <Text style={{ color: mine ? '#E9E3FF' : colors.muted, fontSize: 10, marginTop: 4, alignSelf: 'flex-end' }}>
                      {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </Text>
                  </View>
                );
              }}
              ListFooterComponent={
                <>
                  {typing ? <Text style={{ color: colors.muted, fontStyle: 'italic', marginTop: 4 }}>{other?.name} is typing…</Text> : null}
                  {!active ? <EndedSummary session={session} /> : null}
                </>
              }
            />
          )}

          {!active && isCustomer && session.status === 'ended' && !session.reviewed ? (
            <ReviewForm session={session} onDone={() => setSession({ ...session, reviewed: true })} />
          ) : null}

          {active && !isCall ? (
            <View style={s.composer}>
              <TextInput style={s.composerInput} placeholder="Type a message" placeholderTextColor={colors.muted} value={text} onChangeText={onChangeText} multiline />
              <Pressable onPress={send} style={s.send} disabled={!text.trim()}>
                <Ionicons name="send" size={20} color="#fff" />
              </Pressable>
            </View>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const END_REASONS = {
  ended_by_customer: 'Ended by the client',
  ended_by_astrologer: 'Ended by the astrologer',
  insufficient_balance: 'Wallet balance ran out',
  rejected: 'The astrologer declined the request',
  timeout: 'The request was not answered in time',
  cancelled: 'The request was cancelled',
  server_restart: 'Ended due to a server restart',
};

function EndedSummary({ session }) {
  return (
    <Card style={{ marginTop: 16, alignItems: 'center' }}>
      <Text style={{ fontWeight: '700', color: colors.text }}>{STATUS_LABEL[session.status]}</Text>
      <Text style={{ color: colors.muted, marginTop: 4 }}>{END_REASONS[session.endReason] || ''}</Text>
      {session.status === 'ended' ? (
        <Text style={{ color: colors.text, marginTop: 8 }}>
          {session.billedMinutes} min · {isCustomer ? `Charged ${money(session.amount)}` : `You earned ${money(session.astrologerEarning)}`}
        </Text>
      ) : null}
      {session.reviewed && isCustomer ? <Text style={{ color: colors.success, marginTop: 8 }}>Thanks for your review!</Text> : null}
    </Card>
  );
}

const s = StyleSheet.create({
  bar: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.primarySoft, paddingHorizontal: 16, paddingVertical: 10 },
  barText: { color: colors.primaryDark, fontSize: 13 },
  half: { flex: 1 },
  toggle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6, backgroundColor: colors.primarySoft, borderTopWidth: 1, borderBottomWidth: 1, borderColor: colors.border },
  toggleText: { color: colors.primaryDark, fontWeight: '600', fontSize: 12, marginRight: 4 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32 },
  centerTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: 16, textAlign: 'center' },
  centerSub: { fontSize: 14, color: colors.muted, marginTop: 8, textAlign: 'center' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 8, marginBottom: 8 },
  mine: { alignSelf: 'flex-end', backgroundColor: colors.bubbleMine, borderBottomRightRadius: 4 },
  theirs: { alignSelf: 'flex-start', backgroundColor: colors.bubbleTheirs, borderBottomLeftRadius: 4, borderWidth: 1, borderColor: colors.border },
  composer: { flexDirection: 'row', alignItems: 'flex-end', padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: colors.border },
  composerInput: { flex: 1, maxHeight: 120, backgroundColor: colors.bg, borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, color: colors.text },
  send: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
});
