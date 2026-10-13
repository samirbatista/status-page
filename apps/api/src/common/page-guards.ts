import { NotFoundException } from '@nestjs/common';
import { type Db } from '@status-page/core';

/** Garante que todos os componentes informados estão vinculados à página. */
export async function assertComponentsInPage(
  db: Db,
  pageId: string,
  componentIds: string[],
): Promise<void> {
  const unique = [...new Set(componentIds)];
  if (unique.length === 0) return;
  const found = await db.pageComponent.count({
    where: { pageId, componentId: { in: unique } },
  });
  if (found !== unique.length) throw new NotFoundException({ message: 'component_not_found' });
}
