export const INBOX_SLACK_ACTION_IDS = new Set(['fisher_inbox_ack', 'fisher_inbox_discard']);

const ACTION_BY_ID = {
  fisher_inbox_ack: 'ack',
  fisher_inbox_discard: 'discard',
};

export function parseInboxSlackActionPayload({ body = {}, action = {} } = {}) {
  const actionId = action?.action_id;
  if (!INBOX_SLACK_ACTION_IDS.has(actionId)) {
    return { ok: false, status: 'ignored', text: 'Unsupported inbox Slack action.' };
  }

  let value;
  try {
    value = JSON.parse(action?.value ?? '');
  } catch {
    return { ok: false, status: 'invalid_value', text: 'Inbox action payload is invalid.' };
  }

  const expectedAction = ACTION_BY_ID[actionId];
  const requestedAction = value?.action;
  if (requestedAction !== expectedAction) {
    return { ok: false, status: 'invalid_action', text: 'Inbox action does not match the clicked button.' };
  }

  const member = typeof value?.member === 'string' ? value.member.trim() : '';
  const itemId = typeof value?.item_id === 'string' ? value.item_id.trim() : '';
  const actorSlackUserId = typeof body?.user?.id === 'string' ? body.user.id.trim() : '';

  if (!member || !itemId || !actorSlackUserId) {
    return { ok: false, status: 'missing_target', text: 'Inbox action is missing member, item, or actor.' };
  }

  if (!itemId.startsWith('inbox_')) {
    return { ok: false, status: 'invalid_item', text: 'Inbox action item id is invalid.' };
  }

  return {
    ok: true,
    action: requestedAction,
    member,
    itemId,
    actorSlackUserId,
  };
}

export function inboxSlackActionArgs(parsed) {
  if (!parsed?.ok) throw new Error('Cannot build action args for invalid payload');
  return [
    'action',
    '--action', parsed.action,
    '--member', parsed.member,
    '--item', parsed.itemId,
    '--actor-slack-user-id', parsed.actorSlackUserId,
  ];
}
