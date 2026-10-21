import { type Locale, type NotificationEventType } from '@status-page/shared';

/** Textos padrão das mensagens, por idioma e evento. As variáveis são `{{ nome }}`. */

interface Strings {
  events: Record<NotificationEventType, { label: string; subject: string; body: string }>;
  facts: { status: string; impact: string; components: string; window: string };
  view: string;
  manage: string;
  unsubscribe: string;
  /** Rodapé das mensagens a assinantes. */
  footer: string;
  test: { title: string; body: string };
  code: { subject: string; body: string };
  invite: { subject: string; body: string };
}

const INCIDENT_BODY_PT =
  '{{update.body}}\n\nStatus: {{incident.status}} · {{incident.impact}}\nComponentes: {{components}}';
const INCIDENT_BODY_EN =
  '{{update.body}}\n\nStatus: {{incident.status}} · {{incident.impact}}\nComponents: {{components}}';
const INCIDENT_BODY_ES =
  '{{update.body}}\n\nEstado: {{incident.status}} · {{incident.impact}}\nComponentes: {{components}}';

const MAINT_BODY_PT =
  '{{update.body}}\n\nJanela: {{maintenance.start}} – {{maintenance.end}}\nComponentes: {{components}}';
const MAINT_BODY_EN =
  '{{update.body}}\n\nWindow: {{maintenance.start}} – {{maintenance.end}}\nComponents: {{components}}';
const MAINT_BODY_ES =
  '{{update.body}}\n\nVentana: {{maintenance.start}} – {{maintenance.end}}\nComponentes: {{components}}';

export const STRINGS: Record<Locale, Strings> = {
  'pt-BR': {
    events: {
      incident_created: {
        label: 'Novo incidente',
        subject: '[{{page.name}}] Incidente: {{incident.title}}',
        body: INCIDENT_BODY_PT,
      },
      incident_updated: {
        label: 'Atualização do incidente',
        subject: '[{{page.name}}] Atualização: {{incident.title}}',
        body: INCIDENT_BODY_PT,
      },
      incident_resolved: {
        label: 'Incidente resolvido',
        subject: '[{{page.name}}] Resolvido: {{incident.title}}',
        body: INCIDENT_BODY_PT,
      },
      maintenance_scheduled: {
        label: 'Manutenção agendada',
        subject: '[{{page.name}}] Manutenção agendada: {{maintenance.title}}',
        body: MAINT_BODY_PT,
      },
      maintenance_reminder: {
        label: 'Lembrete de manutenção',
        subject: '[{{page.name}}] Lembrete: manutenção em {{maintenance.start}}',
        body: 'A manutenção "{{maintenance.title}}" começa em breve.\n\nJanela: {{maintenance.start}} – {{maintenance.end}}\nComponentes: {{components}}',
      },
      maintenance_started: {
        label: 'Manutenção iniciada',
        subject: '[{{page.name}}] Manutenção em andamento: {{maintenance.title}}',
        body: MAINT_BODY_PT,
      },
      maintenance_updated: {
        label: 'Atualização da manutenção',
        subject: '[{{page.name}}] Atualização: {{maintenance.title}}',
        body: MAINT_BODY_PT,
      },
      maintenance_completed: {
        label: 'Manutenção concluída',
        subject: '[{{page.name}}] Manutenção concluída: {{maintenance.title}}',
        body: MAINT_BODY_PT,
      },
    },
    facts: { status: 'Status', impact: 'Impacto', components: 'Componentes', window: 'Janela' },
    view: 'Ver na página de status',
    manage: 'Gerenciar inscrição',
    unsubscribe: 'Cancelar inscrição',
    footer: 'Você recebe esta mensagem porque assinou as notificações de {{page.name}}.',
    test: {
      title: 'Mensagem de teste',
      body: 'Este canal está configurado para receber as notificações de {{page.name}}.',
    },
    code: {
      subject: 'Seu código de confirmação: {{code}}',
      body: 'Use o código {{code}} para confirmar a inscrição nas notificações de {{page.name}}. Ele vale por 15 minutos.\n\nSe você não pediu, ignore esta mensagem.',
    },
    invite: {
      subject: 'Confirme sua inscrição em {{page.name}}',
      body: 'Você foi convidado a receber as notificações de {{page.name}}. Para ativar, confirme pelo link abaixo (válido por 7 dias). Sem a confirmação, nenhuma mensagem será enviada.\n\n{{link}}',
    },
  },
  'en-US': {
    events: {
      incident_created: {
        label: 'New incident',
        subject: '[{{page.name}}] Incident: {{incident.title}}',
        body: INCIDENT_BODY_EN,
      },
      incident_updated: {
        label: 'Incident update',
        subject: '[{{page.name}}] Update: {{incident.title}}',
        body: INCIDENT_BODY_EN,
      },
      incident_resolved: {
        label: 'Incident resolved',
        subject: '[{{page.name}}] Resolved: {{incident.title}}',
        body: INCIDENT_BODY_EN,
      },
      maintenance_scheduled: {
        label: 'Scheduled maintenance',
        subject: '[{{page.name}}] Scheduled maintenance: {{maintenance.title}}',
        body: MAINT_BODY_EN,
      },
      maintenance_reminder: {
        label: 'Maintenance reminder',
        subject: '[{{page.name}}] Reminder: maintenance at {{maintenance.start}}',
        body: 'The maintenance "{{maintenance.title}}" starts soon.\n\nWindow: {{maintenance.start}} – {{maintenance.end}}\nComponents: {{components}}',
      },
      maintenance_started: {
        label: 'Maintenance started',
        subject: '[{{page.name}}] Maintenance in progress: {{maintenance.title}}',
        body: MAINT_BODY_EN,
      },
      maintenance_updated: {
        label: 'Maintenance update',
        subject: '[{{page.name}}] Update: {{maintenance.title}}',
        body: MAINT_BODY_EN,
      },
      maintenance_completed: {
        label: 'Maintenance completed',
        subject: '[{{page.name}}] Maintenance completed: {{maintenance.title}}',
        body: MAINT_BODY_EN,
      },
    },
    facts: { status: 'Status', impact: 'Impact', components: 'Components', window: 'Window' },
    view: 'View on the status page',
    manage: 'Manage subscription',
    unsubscribe: 'Unsubscribe',
    footer: 'You receive this message because you subscribed to {{page.name}} notifications.',
    test: {
      title: 'Test message',
      body: 'This channel is set up to receive {{page.name}} notifications.',
    },
    code: {
      subject: 'Your confirmation code: {{code}}',
      body: 'Use the code {{code}} to confirm your subscription to {{page.name}} notifications. It is valid for 15 minutes.\n\nIf you did not ask for it, ignore this message.',
    },
    invite: {
      subject: 'Confirm your subscription to {{page.name}}',
      body: 'You were invited to receive {{page.name}} notifications. To activate, confirm through the link below (valid for 7 days). Without confirmation, no message will be sent.\n\n{{link}}',
    },
  },
  es: {
    events: {
      incident_created: {
        label: 'Nuevo incidente',
        subject: '[{{page.name}}] Incidente: {{incident.title}}',
        body: INCIDENT_BODY_ES,
      },
      incident_updated: {
        label: 'Actualización del incidente',
        subject: '[{{page.name}}] Actualización: {{incident.title}}',
        body: INCIDENT_BODY_ES,
      },
      incident_resolved: {
        label: 'Incidente resuelto',
        subject: '[{{page.name}}] Resuelto: {{incident.title}}',
        body: INCIDENT_BODY_ES,
      },
      maintenance_scheduled: {
        label: 'Mantenimiento programado',
        subject: '[{{page.name}}] Mantenimiento programado: {{maintenance.title}}',
        body: MAINT_BODY_ES,
      },
      maintenance_reminder: {
        label: 'Recordatorio de mantenimiento',
        subject: '[{{page.name}}] Recordatorio: mantenimiento el {{maintenance.start}}',
        body: 'El mantenimiento "{{maintenance.title}}" comienza pronto.\n\nVentana: {{maintenance.start}} – {{maintenance.end}}\nComponentes: {{components}}',
      },
      maintenance_started: {
        label: 'Mantenimiento iniciado',
        subject: '[{{page.name}}] Mantenimiento en curso: {{maintenance.title}}',
        body: MAINT_BODY_ES,
      },
      maintenance_updated: {
        label: 'Actualización del mantenimiento',
        subject: '[{{page.name}}] Actualización: {{maintenance.title}}',
        body: MAINT_BODY_ES,
      },
      maintenance_completed: {
        label: 'Mantenimiento completado',
        subject: '[{{page.name}}] Mantenimiento completado: {{maintenance.title}}',
        body: MAINT_BODY_ES,
      },
    },
    facts: { status: 'Estado', impact: 'Impacto', components: 'Componentes', window: 'Ventana' },
    view: 'Ver en la página de estado',
    manage: 'Gestionar suscripción',
    unsubscribe: 'Cancelar suscripción',
    footer: 'Recibe este mensaje porque se suscribió a las notificaciones de {{page.name}}.',
    test: {
      title: 'Mensaje de prueba',
      body: 'Este canal está configurado para recibir las notificaciones de {{page.name}}.',
    },
    code: {
      subject: 'Su código de confirmación: {{code}}',
      body: 'Use el código {{code}} para confirmar la suscripción a las notificaciones de {{page.name}}. Es válido por 15 minutos.\n\nSi no lo solicitó, ignore este mensaje.',
    },
    invite: {
      subject: 'Confirme su suscripción a {{page.name}}',
      body: 'Fue invitado a recibir las notificaciones de {{page.name}}. Para activarlas, confirme en el enlace de abajo (válido por 7 días). Sin la confirmación, no se enviará ningún mensaje.\n\n{{link}}',
    },
  },
};
