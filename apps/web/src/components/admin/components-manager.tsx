'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { api } from '@/lib/client-api';
import { type Structure } from '@/lib/types';
import { useAction } from '@/lib/use-action';
import { ApiErrorAlert } from '../api-error';
import { Button, Card, Checkbox, EmptyState, Field, Input, Select } from '../ui/ui';
import { ComponentStatusSelect } from './component-status-select';

type Component = Structure['components'][number];

export function ComponentsManager({
  pageId,
  structure,
  canAdmin,
  canOperate,
}: {
  pageId: string;
  structure: Structure;
  canAdmin: boolean;
  canOperate: boolean;
}) {
  const t = useTranslations('admin.components');
  const { run, pending, error } = useAction();
  const [editing, setEditing] = useState<string | null>(null);

  const sections: { id: string | null; name: string; collapsed?: boolean }[] = [
    ...structure.groups.map((g) => ({ id: g.id, name: g.name, collapsed: g.collapsed })),
    { id: null, name: t('ungrouped') },
  ];

  /** Envia a ordem completa após mover um item uma posição para cima/baixo. */
  function move(list: string[], id: string, delta: number): string[] {
    const index = list.indexOf(id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= list.length) return list;
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    return next;
  }

  function saveLayout(groups: string[], components: Component[]) {
    return run(() =>
      api(`/pages/${pageId}/layout`, {
        method: 'PUT',
        body: {
          groups,
          components: components.map((c) => ({ componentId: c.id, groupId: c.groupId })),
        },
      }),
    );
  }

  function moveComponent(component: Component, delta: number) {
    const sameGroup = structure.components
      .filter((c) => c.groupId === component.groupId)
      .map((c) => c.id);
    const reordered = move(sameGroup, component.id, delta);
    const others = structure.components.filter((c) => c.groupId !== component.groupId);
    const byId = new Map(structure.components.map((c) => [c.id, c]));
    void saveLayout(
      structure.groups.map((g) => g.id),
      [...others, ...reordered.map((id) => byId.get(id)!)],
    );
  }

  function moveGroup(groupId: string, delta: number) {
    void saveLayout(
      move(
        structure.groups.map((g) => g.id),
        groupId,
        delta,
      ),
      structure.components,
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ApiErrorAlert error={error} />
      {sections.map((section) => {
        const items = structure.components.filter((c) => c.groupId === section.id);
        if (section.id === null && items.length === 0 && structure.groups.length > 0) return null;
        return (
          <Card
            key={section.id ?? 'ungrouped'}
            title={section.name}
            actions={
              canAdmin && section.id ? (
                <GroupActions
                  pageId={pageId}
                  groupId={section.id}
                  name={section.name}
                  collapsed={section.collapsed ?? false}
                  onMove={(delta) => moveGroup(section.id!, delta)}
                  disabled={pending}
                />
              ) : null
            }
          >
            {items.length === 0 ? (
              <EmptyState>{t('emptyGroup')}</EmptyState>
            ) : (
              <ul className="flex flex-col divide-y divide-[var(--border)]">
                {items.map((c) => (
                  <li key={c.id} className="flex flex-col gap-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium">{c.name}</p>
                        {c.description ? (
                          <p className="text-sm text-[var(--muted)]">{c.description}</p>
                        ) : null}
                        {c.sharedWithPages > 0 ? (
                          <p className="text-xs text-[var(--muted)]">
                            {t('shared', { count: c.sharedWithPages })}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <ComponentStatusSelect
                          pageId={pageId}
                          componentId={c.id}
                          name={c.name}
                          status={c.status}
                          disabled={!canOperate}
                        />
                        {canAdmin ? (
                          <>
                            <Button
                              variant="ghost"
                              aria-label={t('moveUp')}
                              disabled={pending}
                              onClick={() => moveComponent(c, -1)}
                            >
                              ↑
                            </Button>
                            <Button
                              variant="ghost"
                              aria-label={t('moveDown')}
                              disabled={pending}
                              onClick={() => moveComponent(c, 1)}
                            >
                              ↓
                            </Button>
                            <Button
                              variant="secondary"
                              onClick={() => setEditing(editing === c.id ? null : c.id)}
                            >
                              {t('edit')}
                            </Button>
                          </>
                        ) : null}
                      </div>
                    </div>
                    {editing === c.id ? (
                      <ComponentEditor
                        pageId={pageId}
                        component={c}
                        groups={structure.groups}
                        onDone={() => setEditing(null)}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
      {canAdmin ? (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title={t('newComponent')}>
            <NewComponentForm pageId={pageId} groups={structure.groups} />
          </Card>
          <Card title={t('newGroup')}>
            <NewGroupForm pageId={pageId} />
          </Card>
        </div>
      ) : null}
    </div>
  );
}

function GroupActions({
  pageId,
  groupId,
  name,
  collapsed,
  onMove,
  disabled,
}: {
  pageId: string;
  groupId: string;
  name: string;
  collapsed: boolean;
  onMove: (delta: number) => void;
  disabled: boolean;
}) {
  const t = useTranslations('admin.components');
  const tAdmin = useTranslations('admin');
  const { run, pending } = useAction();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button
        variant="ghost"
        aria-label={t('moveUp')}
        disabled={disabled}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        aria-label={t('moveDown')}
        disabled={disabled}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() => {
          const next = window.prompt(t('renameGroup'), name);
          if (next && next.trim()) {
            void run(() =>
              api(`/pages/${pageId}/groups/${groupId}`, {
                method: 'PATCH',
                body: { name: next.trim() },
              }),
            );
          }
        }}
      >
        {t('rename')}
      </Button>
      <Button
        variant="ghost"
        disabled={pending}
        onClick={() =>
          run(() =>
            api(`/pages/${pageId}/groups/${groupId}`, {
              method: 'PATCH',
              body: { collapsed: !collapsed },
            }),
          )
        }
      >
        {collapsed ? t('expandByDefault') : t('collapseByDefault')}
      </Button>
      <Button
        variant="ghost"
        className="text-status-major_outage"
        disabled={pending}
        onClick={() => {
          if (window.confirm(t('confirmDeleteGroup'))) {
            void run(() => api(`/pages/${pageId}/groups/${groupId}`, { method: 'DELETE' }));
          }
        }}
      >
        {tAdmin('delete')}
      </Button>
    </div>
  );
}

function ComponentEditor({
  pageId,
  component,
  groups,
  onDone,
}: {
  pageId: string;
  component: Component;
  groups: Structure['groups'];
  onDone: () => void;
}) {
  const t = useTranslations('admin.components');
  const tAdmin = useTranslations('admin');
  const { run, pending, error } = useAction();
  const [showUptime, setShowUptime] = useState(component.showUptime);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const groupId = String(form.get('groupId'));
    const ok = await run(() =>
      api(`/pages/${pageId}/components/${component.id}`, {
        method: 'PATCH',
        body: {
          name: form.get('name'),
          description: form.get('description'),
          groupId: groupId || null,
          showUptime,
        },
      }).then(() => true),
    );
    if (ok) onDone();
  }

  return (
    <form
      onSubmit={onSubmit}
      className="grid gap-3 rounded-md bg-[var(--background)] p-3 sm:grid-cols-2"
    >
      <Field label={t('name')}>
        <Input name="name" defaultValue={component.name} required maxLength={120} />
      </Field>
      <Field label={t('group')}>
        <Select name="groupId" defaultValue={component.groupId ?? ''}>
          <option value="">{t('ungrouped')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <Field label={t('description')} className="sm:col-span-2">
        <Input name="description" defaultValue={component.description ?? ''} maxLength={500} />
      </Field>
      <Checkbox
        label={t('showUptime')}
        checked={showUptime}
        onChange={(e) => setShowUptime(e.target.checked)}
      />
      <div className="flex flex-wrap justify-end gap-2 sm:col-span-2">
        <Button
          variant="danger"
          disabled={pending}
          onClick={async () => {
            const message = component.sharedWithPages > 0 ? t('confirmDetach') : t('confirmDelete');
            if (!window.confirm(message)) return;
            await run(() =>
              api(`/pages/${pageId}/components/${component.id}`, { method: 'DELETE' }),
            );
          }}
        >
          {component.sharedWithPages > 0 ? t('detach') : tAdmin('delete')}
        </Button>
        <Button variant="secondary" onClick={onDone}>
          {tAdmin('cancel')}
        </Button>
        <Button type="submit" disabled={pending}>
          {tAdmin('save')}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <ApiErrorAlert error={error} />
      </div>
    </form>
  );
}

function NewComponentForm({ pageId, groups }: { pageId: string; groups: Structure['groups'] }) {
  const t = useTranslations('admin.components');
  const { run, pending, error } = useAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const groupId = String(form.get('groupId'));
        const ok = await run(() =>
          api(`/pages/${pageId}/components`, {
            method: 'POST',
            body: {
              name: form.get('name'),
              description: form.get('description'),
              groupId: groupId || null,
            },
          }).then(() => true),
        );
        if (ok) formElement.reset();
      }}
    >
      <Field label={t('name')}>
        <Input name="name" required maxLength={120} />
      </Field>
      <Field label={t('description')}>
        <Input name="description" maxLength={500} />
      </Field>
      <Field label={t('group')}>
        <Select name="groupId" defaultValue="">
          <option value="">{t('ungrouped')}</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </Select>
      </Field>
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('add')}
        </Button>
      </div>
    </form>
  );
}

function NewGroupForm({ pageId }: { pageId: string }) {
  const t = useTranslations('admin.components');
  const { run, pending, error } = useAction();
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={async (event) => {
        event.preventDefault();
        const formElement = event.currentTarget;
        const form = new FormData(formElement);
        const ok = await run(() =>
          api(`/pages/${pageId}/groups`, { method: 'POST', body: { name: form.get('name') } }).then(
            () => true,
          ),
        );
        if (ok) formElement.reset();
      }}
    >
      <Field label={t('name')}>
        <Input name="name" required maxLength={120} />
      </Field>
      <ApiErrorAlert error={error} />
      <div>
        <Button type="submit" disabled={pending}>
          {t('add')}
        </Button>
      </div>
    </form>
  );
}
