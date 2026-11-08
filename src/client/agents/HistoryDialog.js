import { h, useState, useEffect, useCallback, useRef } from '../react.js'
import { t, callApi, formatAgo, formatClock, historyTime, historyAudioUrl } from '../core.js'

    /**
     * 智能体历史对话弹窗：左侧会话列表（title + 相对时间 + N 条），右侧消息气泡。
     *
     * 会话来自该智能体绑定的所有设备（`/history/agent-conversations`），每条带
     * `deviceId` / `deviceName`；消息详情与音频仍按设备取（历史文件本来就按设备落盘）。
     * 音频单实例：切会话/关闭弹窗时暂停并释放上一份 Audio（用代际号隔离迟到的 ended/error）。
     */
    function HistoryDialog({ agent, onClose }) {
      const agentId = agent.id;
      const [conversations, setConversations] = useState([]);
      const [loading, setLoading] = useState(true);
      const [listError, setListError] = useState('');
      const [selectedId, setSelectedId] = useState('');
      const [detail, setDetail] = useState(null);
      const [detailLoading, setDetailLoading] = useState(false);
      const [detailError, setDetailError] = useState('');
      const [playingId, setPlayingId] = useState('');
      const [audioError, setAudioError] = useState('');
      const [clearing, setClearing] = useState(false);
      // 刷新同时重拉详情：只重拉列表时若选中的会话没变，详情不会重新请求。
      const [reloadTick, setReloadTick] = useState(0);
      const audioRef = useRef(null);
      const audioGenRef = useRef(0);
      const listReqRef = useRef(0);
      // 选中的会话属于哪台设备：详情/音频都按它取。
      const selectedDeviceId = (conversations.find((item) => item.sessionId === selectedId) || {}).deviceId || '';

      const stopAudio = useCallback(() => {
        audioGenRef.current += 1;
        const audio = audioRef.current;
        audioRef.current = null;
        if (audio) {
          try {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
          } catch {
            /* 释放失败不影响 UI */
          }
        }
        setPlayingId('');
        setAudioError('');
      }, []);

      const loadList = useCallback(async (preferSessionId) => {
        const gen = listReqRef.current + 1;
        listReqRef.current = gen;
        setLoading(true);
        setListError('');
        try {
          const data = await callApi(
            `/history/agent-conversations?agentId=${encodeURIComponent(agentId)}&limit=50`
          );
          if (listReqRef.current !== gen) return;
          const list = Array.isArray(data?.conversations) ? data.conversations : [];
          setConversations(list);
          setSelectedId((current) => {
            const wanted = preferSessionId || current;
            if (wanted && list.some((item) => item.sessionId === wanted)) return wanted;
            return list[0]?.sessionId || '';
          });
        } catch (error) {
          if (listReqRef.current !== gen) return;
          setConversations([]);
          setSelectedId('');
          setListError(error?.message || t('loadFailed'));
        } finally {
          if (listReqRef.current === gen) setLoading(false);
        }
      }, [agentId]);

      useEffect(() => {
        loadList();
        return () => {
          // 卸载后迟到的列表响应直接丢弃，不落状态。
          listReqRef.current += 1;
        };
      }, [loadList]);

      // 切会话：先停掉上一段的音频，再拉消息详情。
      useEffect(() => {
        stopAudio();
        if (!selectedId || !selectedDeviceId) {
          setDetail(null);
          setDetailError('');
          setDetailLoading(false);
          return undefined;
        }
        let alive = true;
        setDetailLoading(true);
        setDetailError('');
        callApi(
          `/history/conversation?deviceId=${encodeURIComponent(selectedDeviceId)}&sessionId=${encodeURIComponent(selectedId)}`
        )
          .then((data) => {
            if (!alive) return;
            setDetail(data || null);
          })
          .catch((error) => {
            if (!alive) return;
            setDetail(null);
            setDetailError(error?.message || t('loadFailed'));
          })
          .finally(() => {
            if (alive) setDetailLoading(false);
          });
        return () => {
          alive = false;
        };
      }, [selectedDeviceId, selectedId, reloadTick, stopAudio]);

      // 关闭弹窗：释放正在播放的 Audio，避免继续占资源和出声。
      useEffect(() => () => {
        audioGenRef.current += 1;
        const audio = audioRef.current;
        audioRef.current = null;
        if (audio) {
          try {
            audio.pause();
            audio.removeAttribute('src');
            audio.load();
          } catch {
            /* ignore */
          }
        }
      }, []);

      const toggleAudio = (audioId) => {
        const key = String(audioId);
        if (playingId === key) {
          stopAudio();
          return;
        }
        stopAudio();
        setAudioError('');
        const gen = audioGenRef.current;
        const audio = new Audio(historyAudioUrl(selectedDeviceId, audioId));
        audioRef.current = audio;
        const release = () => {
          if (audioGenRef.current !== gen) return;
          audioRef.current = null;
          setPlayingId('');
        };
        audio.onended = release;
        audio.onerror = () => {
          if (audioGenRef.current !== gen) return;
          release();
          setAudioError(t('historyAudioFailed'));
        };
        setPlayingId(key);
        const result = audio.play();
        if (result && typeof result.catch === 'function') {
          result.catch(() => {
            if (audioGenRef.current !== gen) return;
            release();
            setAudioError(t('historyAudioFailed'));
          });
        }
      };

      const clearHistory = async () => {
        if (!window.confirm(t('historyClearConfirm'))) return;
        setClearing(true);
        setListError('');
        try {
          // 智能体的历史分散在它绑定的每台设备上：逐台清，避免留半份。
          for (const device of agent.devices || []) {
            await callApi('/history/clear', { method: 'POST', body: { deviceId: device.deviceId } });
          }
          stopAudio();
          setDetail(null);
          setSelectedId('');
          await loadList('');
        } catch (error) {
          setListError(`${t('historyClearFailed')}${error?.message || ''}`);
        } finally {
          setClearing(false);
        }
      };

      const messages = Array.isArray(detail?.messages) ? detail.messages : [];
      const selected = conversations.find((item) => item.sessionId === selectedId) || null;
      const subtitle = detail?.title || selected?.title || '';

      return h('div', { className: 'xz-modal-mask', onClick: onClose },
        h('div', {
          className: 'xz-modal xz-history-modal',
          role: 'dialog',
          'aria-modal': 'true',
          onClick: (event) => event.stopPropagation()
        },
          h('div', { className: 'xz-history-head' },
            h('div', { className: 'xz-history-head-titles' },
              h('h3', null, `${agent.name || t('unnamed')}${t('historyTitleSuffix')}`),
              subtitle ? h('p', { className: 'xz-history-sub' }, subtitle) : null
            ),
            h('div', { className: 'xz-history-head-actions' },
              h('button', {
                type: 'button',
                className: 'xz-btn',
                disabled: loading || clearing,
                onClick: () => {
                  setReloadTick((n) => n + 1);
                  loadList(selectedId);
                }
              }, t('historyRefresh')),
              h('button', {
                type: 'button',
                className: 'xz-btn danger',
                disabled: loading || clearing,
                onClick: clearHistory
              }, clearing ? '…' : t('historyClear')),
              h('button', {
                type: 'button',
                className: 'xz-btn',
                'aria-label': t('close'),
                onClick: onClose
              }, '×')
            )
          ),
          h('div', { className: 'xz-history-body' },
            h('div', { className: 'xz-history-list' },
              loading
                ? h('div', { className: 'xz-history-hint' }, t('historyLoading'))
                : listError
                  ? h('div', { className: 'xz-history-hint xz-history-error' }, listError)
                  : conversations.length === 0
                    ? h('div', { className: 'xz-history-hint' }, t('historyEmpty'))
                    : conversations.map((item) => {
                        const started = historyTime(item.startedAt || item.endedAt);
                        const count = Array.isArray(item.messages)
                          ? item.messages.length
                          : Number(item.messages) || 0;
                        return h('button', {
                          key: `${item.deviceId || ''}:${item.sessionId}`,
                          type: 'button',
                          className: `xz-history-item ${item.sessionId === selectedId ? 'active' : ''}`,
                          onClick: () => setSelectedId(item.sessionId)
                        },
                          h('span', { className: 'xz-history-item-title' },
                            item.title || item.preview || t('historyUntitled')),
                          h('span', { className: 'xz-history-item-meta' },
                            [
                              item.deviceName || '',
                              started ? formatAgo(started) : '',
                              t('messageCount').replace('{n}', String(count))
                            ].filter(Boolean).join(' · ')
                          )
                        );
                      })
            ),
            h('div', { className: 'xz-history-thread' },
              detailLoading || (loading && !selectedId)
                ? h('div', { className: 'xz-history-hint' }, t('historyLoading'))
                : detailError && messages.length === 0
                  ? h('div', { className: 'xz-history-hint xz-history-error' }, detailError)
                  : !selectedId
                    ? h('div', { className: 'xz-history-hint' }, t('historyPickConversation'))
                    : messages.length === 0
                      ? h('div', { className: 'xz-history-hint' }, t('historyEmpty'))
                      : messages.map((message, index) => {
                          const role = message.role === 'user' ? 'user' : 'assistant';
                          const audioId = message.audioId;
                          const playing = audioId != null && String(audioId) === playingId;
                          const clock = formatClock(message.at);
                          return h('div', { key: `${selectedId}-${index}`, className: `xz-history-msg ${role}` },
                            h('div', { className: 'xz-history-bubble' }, message.content ?? ''),
                            h('div', { className: 'xz-history-msg-meta' },
                              clock ? h('span', null, clock) : null,
                              audioId != null
                                ? h('button', {
                                    type: 'button',
                                    className: 'xz-history-audio',
                                    title: playing ? t('historyPause') : t('historyPlay'),
                                    'aria-label': playing ? t('historyPause') : t('historyPlay'),
                                    onClick: () => toggleAudio(audioId)
                                  }, playing ? '⏸' : '▶')
                                : null,
                              audioId != null
                                ? h('a', {
                                    className: 'xz-history-audio',
                                    href: historyAudioUrl(selectedDeviceId, audioId),
                                    download: `${String(audioId)}.wav`,
                                    title: t('historyDownload'),
                                    'aria-label': t('historyDownload')
                                  }, '⬇')
                                : null
                            ),
                            role === 'assistant'
                              ? h('div', { className: 'xz-history-ai' }, t('aiGenerated'))
                              : null
                          );
                        })
            )
          ),
          h('div', { className: 'xz-history-foot' },
            audioError ? h('span', { className: 'xz-history-error' }, audioError) : t('historyAudioRetention')
          )
        )
      );
    }
export { HistoryDialog }
