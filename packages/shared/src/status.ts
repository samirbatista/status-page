/**
 * Status de um componente, do melhor para o pior. A ordem do array define a
 * severidade usada para calcular o status geral da página.
 */
export const COMPONENT_STATUSES = [
  'operational',
  'under_maintenance',
  'degraded_performance',
  'partial_outage',
  'major_outage',
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

export const INCIDENT_STATUSES = ['investigating', 'identified', 'monitoring', 'resolved'] as const;
export type IncidentStatus = (typeof INCIDENT_STATUSES)[number];

export const INCIDENT_IMPACTS = ['none', 'minor', 'major', 'critical'] as const;
export type IncidentImpact = (typeof INCIDENT_IMPACTS)[number];

export const MAINTENANCE_STATUSES = ['scheduled', 'in_progress', 'completed'] as const;
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number];

export function statusSeverity(status: ComponentStatus): number {
  return COMPONENT_STATUSES.indexOf(status);
}

/** Pior status entre os componentes informados; `operational` se a lista for vazia. */
export function overallStatus(statuses: Iterable<ComponentStatus>): ComponentStatus {
  let worst: ComponentStatus = 'operational';
  for (const status of statuses) {
    if (statusSeverity(status) > statusSeverity(worst)) worst = status;
  }
  return worst;
}
