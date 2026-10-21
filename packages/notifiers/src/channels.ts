import { createHmac } from 'node:crypto';
import nodemailer from 'nodemailer';
import { postJson } from './http.js';
import {
  type Destination,
  NotifierError,
  type ProviderSettings,
  type RenderedMessage,
  type SmtpSettings,
  type TelegramSettings,
  type WhatsappSettings,
} from './types.js';

/** Links do rodapé: ver o evento e, para assinantes, gerenciar e cancelar. */
function linkList(message: RenderedMessage): { label: string; url: string }[] {
  const { links, labels } = message;
  return [
    { label: labels.view, url: links.itemUrl || links.pageUrl },
    ...(links.manageUrl ? [{ label: labels.manage, url: links.manageUrl }] : []),
    ...(links.unsubscribeUrl ? [{ label: labels.unsubscribe, url: links.unsubscribeUrl }] : []),
  ];
}

/** Texto puro completo (e-mail em texto, WhatsApp, webhook). */
export function plainText(message: RenderedMessage): string {
  const lines = [message.text, '', ...linkList(message).map((l) => `${l.label}: ${l.url}`)];
  if (message.links.manageUrl) lines.push('', message.labels.footer);
  return lines.join('\n');
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- E-mail ------------------------------------------------------------------------

export function emailHtml(message: RenderedMessage): string {
  const paragraphs = message.text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  const links = linkList(message)
    .map(
      (l, i) =>
        `<a href="${escapeHtml(l.url)}" style="${
          i === 0
            ? 'display:inline-block;padding:8px 14px;border-radius:6px;background:#2563eb;color:#fff;text-decoration:none'
            : 'color:#555'
        }">${escapeHtml(l.label)}</a>`,
    )
    .join(' &nbsp; ');
  const footer = message.links.manageUrl
    ? `<p style="margin:16px 0 0;font-size:12px;color:#777">${escapeHtml(message.labels.footer)}</p>`
    : '';
  return `<!doctype html><html lang="${message.locale}"><body style="margin:0;background:#f5f6f8;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#1f2328">
<div style="max-width:600px;margin:0 auto;padding:24px">
<div style="background:#fff;border-radius:8px;border-top:4px solid ${message.color};padding:24px">
<h1 style="margin:0 0 16px;font-size:18px">${escapeHtml(message.title)}</h1>
${paragraphs}
<p style="margin:20px 0 0">${links}</p>
${footer}
</div></div></body></html>`;
}

export async function sendEmail(
  smtp: SmtpSettings,
  to: string[],
  content: { subject: string; text: string; html?: string; listUnsubscribe?: string },
): Promise<void> {
  const transport = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.security === 'tls',
    requireTLS: smtp.security === 'starttls',
    ignoreTLS: smtp.security === 'none',
    auth: smtp.username ? { user: smtp.username, pass: smtp.password } : undefined,
    tls: { rejectUnauthorized: smtp.verifyCertificate },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transport.sendMail({
      from: smtp.from,
      to,
      subject: content.subject,
      text: content.text,
      html: content.html,
      ...(content.listUnsubscribe
        ? {
            list: { unsubscribe: { url: content.listUnsubscribe, comment: 'Unsubscribe' } },
          }
        : {}),
    });
  } catch (error) {
    const err = error as { responseCode?: number; code?: string; message?: string };
    // 5xx do servidor SMTP é recusa definitiva (endereço inválido, autenticação).
    const permanent =
      (err.responseCode !== undefined && err.responseCode >= 500) || err.code === 'EAUTH';
    throw new NotifierError(`smtp: ${err.message ?? String(error)}`.slice(0, 300), !permanent);
  } finally {
    transport.close();
  }
}

// --- Webhooks de chat ---------------------------------------------------------------

export function slackPayload(message: RenderedMessage) {
  const links = linkList(message)
    .map((l) => `<${l.url}|${l.label}>`)
    .join(' · ');
  return {
    text: message.subject,
    attachments: [
      {
        color: message.color,
        blocks: [
          { type: 'header', text: { type: 'plain_text', text: message.title.slice(0, 150) } },
          { type: 'section', text: { type: 'mrkdwn', text: message.text.slice(0, 3000) } },
          { type: 'context', elements: [{ type: 'mrkdwn', text: links }] },
        ],
      },
    ],
  };
}

export function discordPayload(message: RenderedMessage) {
  const links = linkList(message);
  return {
    username: 'Status Page',
    embeds: [
      {
        title: message.title.slice(0, 256),
        url: links[0]!.url,
        description: message.text.slice(0, 4000),
        color: Number.parseInt(message.color.slice(1), 16),
        fields: links.slice(1).map((l) => ({ name: l.label, value: l.url, inline: true })),
        timestamp: new Date().toISOString(),
      },
    ],
    allowed_mentions: { parse: [] },
  };
}

/** Teams via Workflows (Power Automate): mensagem com Adaptive Card. */
export function teamsPayload(message: RenderedMessage) {
  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        contentUrl: null,
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          msteams: { width: 'Full' },
          body: [
            {
              type: 'TextBlock',
              text: message.title,
              weight: 'Bolder',
              size: 'Medium',
              wrap: true,
              color: message.event.endsWith('resolved') ? 'Good' : 'Attention',
            },
            { type: 'TextBlock', text: message.text, wrap: true },
            ...(message.facts.length
              ? [
                  {
                    type: 'FactSet',
                    facts: message.facts.map((f) => ({ title: f.label, value: f.value })),
                  },
                ]
              : []),
          ],
          actions: linkList(message).map((l) => ({
            type: 'Action.OpenUrl',
            title: l.label,
            url: l.url,
          })),
        },
      },
    ],
  };
}

export function googleChatPayload(message: RenderedMessage) {
  return {
    text: message.subject,
    cardsV2: [
      {
        cardId: 'status-page',
        card: {
          header: { title: message.title.slice(0, 200), subtitle: message.subject.slice(0, 200) },
          sections: [
            {
              widgets: [
                { textParagraph: { text: escapeHtml(message.text).replace(/\n/g, '<br>') } },
                {
                  buttonList: {
                    buttons: linkList(message).map((l) => ({
                      text: l.label,
                      onClick: { openLink: { url: l.url } },
                    })),
                  },
                },
              ],
            },
          ],
        },
      },
    ],
  };
}

// --- Telegram ------------------------------------------------------------------------

export function telegramText(message: RenderedMessage): string {
  const links = linkList(message)
    .map((l) => `<a href="${escapeHtml(l.url)}">${escapeHtml(l.label)}</a>`)
    .join(' · ');
  return `<b>${escapeHtml(message.title)}</b>\n\n${escapeHtml(message.text)}\n\n${links}`.slice(
    0,
    4096,
  );
}

export async function telegramCall(
  settings: TelegramSettings,
  method: string,
  body: unknown,
): Promise<unknown> {
  const base = settings.apiUrl ?? 'https://api.telegram.org';
  const { text } = await postJson(`${base}/bot${settings.botToken}/${method}`, body);
  const parsed = JSON.parse(text) as { ok: boolean; result?: unknown; description?: string };
  if (!parsed.ok) throw new NotifierError(`telegram: ${parsed.description ?? 'erro'}`, false);
  return parsed.result;
}

export async function telegramSend(settings: TelegramSettings, chatId: string, html: string) {
  await telegramCall(settings, 'sendMessage', {
    chat_id: chatId,
    text: html,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
  });
}

// --- WhatsApp Cloud API ---------------------------------------------------------------

function whatsappUrl(settings: WhatsappSettings): string {
  const base = settings.apiUrl ?? 'https://graph.facebook.com/v21.0';
  return `${base}/${settings.phoneNumberId}/messages`;
}

/**
 * Fora da janela de 24 h, o WhatsApp só aceita templates aprovados. O template
 * de notificação tem duas variáveis no corpo: {{1}} título e {{2}} texto.
 */
export async function whatsappNotify(
  settings: WhatsappSettings,
  phone: string,
  message: RenderedMessage,
) {
  // Parâmetros de template não aceitam quebras de linha nem mais de 4 espaços seguidos.
  const clean = (v: string, max: number) =>
    v
      .replace(/\s*\n+\s*/g, ' · ')
      .replace(/ {4,}/g, ' ')
      .slice(0, max);
  await postJson(
    whatsappUrl(settings),
    {
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: settings.notificationTemplate,
        language: { code: settings.templateLanguage },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: clean(message.subject, 200) },
              {
                type: 'text',
                text: clean(
                  `${message.text} ${message.links.itemUrl || message.links.pageUrl}`,
                  900,
                ),
              },
            ],
          },
        ],
      },
    },
    { headers: { Authorization: `Bearer ${settings.accessToken}` } },
  );
}

/** Código de confirmação pelo template de autenticação (botão "copiar código"). */
export async function whatsappCode(settings: WhatsappSettings, phone: string, code: string) {
  await postJson(
    whatsappUrl(settings),
    {
      messaging_product: 'whatsapp',
      to: phone.replace(/^\+/, ''),
      type: 'template',
      template: {
        name: settings.authTemplate,
        language: { code: settings.templateLanguage },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: code }] },
          {
            type: 'button',
            sub_type: 'url',
            index: '0',
            parameters: [{ type: 'text', text: code }],
          },
        ],
      },
    },
    { headers: { Authorization: `Bearer ${settings.accessToken}` } },
  );
}

// --- Webhook genérico ---------------------------------------------------------------

/** Assinatura `sha256=<hex>` de `<timestamp>.<corpo>`, como o cabeçalho X-StatusPage-Signature. */
export function signWebhook(secret: string, timestamp: string, body: string): string {
  return `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;
}

export function webhookBody(message: RenderedMessage, data: unknown) {
  return {
    event: message.event,
    subject: message.subject,
    text: message.text,
    url: message.links.itemUrl || message.links.pageUrl,
    data,
    sentAt: new Date().toISOString(),
  };
}

// --- Despacho -------------------------------------------------------------------------

/**
 * Envia a mensagem ao destino. `data` vai no corpo do webhook genérico (o
 * retrato do evento). Lança `NotifierError` em caso de falha.
 */
export async function deliver(
  destination: Destination,
  message: RenderedMessage,
  settings: ProviderSettings,
  data: unknown = null,
): Promise<void> {
  switch (destination.kind) {
    case 'email': {
      if (!settings.smtp) throw new NotifierError('smtp_not_configured', false);
      await sendEmail(settings.smtp, destination.recipients, {
        subject: message.subject,
        text: plainText(message),
        html: emailHtml(message),
        listUnsubscribe: message.links.unsubscribeUrl,
      });
      return;
    }
    case 'telegram': {
      if (!settings.telegram) throw new NotifierError('telegram_not_configured', false);
      await telegramSend(settings.telegram, destination.chatId, telegramText(message));
      return;
    }
    case 'whatsapp': {
      if (!settings.whatsapp) throw new NotifierError('whatsapp_not_configured', false);
      for (const phone of destination.phones) {
        await whatsappNotify(settings.whatsapp, phone, message);
      }
      return;
    }
    case 'slack':
      await postJson(destination.webhookUrl, slackPayload(message));
      return;
    case 'discord':
      await postJson(destination.webhookUrl, discordPayload(message));
      return;
    case 'teams':
      await postJson(destination.webhookUrl, teamsPayload(message));
      return;
    case 'google_chat':
      await postJson(destination.webhookUrl, googleChatPayload(message), {
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
      });
      return;
    case 'webhook': {
      const body = JSON.stringify(webhookBody(message, data));
      const timestamp = String(Math.floor(Date.now() / 1000));
      await postJson(destination.url, null, {
        rawBody: body,
        headers: {
          'User-Agent': 'StatusPage-Webhook/1',
          'X-StatusPage-Event': message.event,
          'X-StatusPage-Timestamp': timestamp,
          ...(destination.secret
            ? { 'X-StatusPage-Signature': signWebhook(destination.secret, timestamp, body) }
            : {}),
        },
      });
      return;
    }
  }
}
