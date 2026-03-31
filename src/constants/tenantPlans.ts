import type { TenantPlan } from '../types/database.types';

export type TenantPlanOption = {
  value: TenantPlan;
  title: string;
  priceLabel: string;
  summary: string;
  description: string;
  available: boolean;
  badge?: string;
};

export const DEFAULT_TENANT_PLAN: TenantPlan = 'free';

export const TENANT_PLAN_OPTIONS: TenantPlanOption[] = [
  {
    value: 'free',
    title: 'Free',
    priceLabel: 'Gratis',
    summary: 'Para empezar con una sola familia.',
    description: 'Crea tu grupo familiar, agrega miembros y usa el historial medico compartido.',
    available: true,
  },
  {
    value: 'pro',
    title: 'Pro',
    priceLabel: 'Proximamente',
    summary: 'Para familias que quieren mas automatizacion.',
    description: 'Lo dejaremos listo mas adelante con beneficios adicionales y cobro.',
    available: false,
    badge: 'Pronto',
  },
  {
    value: 'family',
    title: 'Family+',
    priceLabel: 'Proximamente',
    summary: 'Pensado para administracion familiar mas amplia.',
    description: 'Se habilitara despues, cuando definamos bien la suscripcion.',
    available: false,
    badge: 'Pronto',
  },
];

export function getTenantPlanLabel(plan?: TenantPlan | string | null) {
  switch (plan) {
    case 'pro':
      return 'Pro';
    case 'family':
      return 'Family+';
    case 'free':
    default:
      return 'Free';
  }
}
