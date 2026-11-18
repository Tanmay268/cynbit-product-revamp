import type { PrismaClient } from '@prisma/client';
import type { CreateLeadInput } from '@wi/shared';

export type LeadRecord = Omit<CreateLeadInput, 'hp'>;

export interface LeadRepository {
  create(lead: LeadRecord): Promise<{ id: string }>;
}

export class PrismaLeadRepository implements LeadRepository {
  constructor(private readonly prisma: PrismaClient) {}

  create(lead: LeadRecord) {
    return this.prisma.lead.create({
      data: { name: lead.name, email: lead.email, company: lead.company, website: lead.website, message: lead.message },
      select: { id: true },
    });
  }
}
