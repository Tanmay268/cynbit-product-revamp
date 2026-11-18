import type { CreateLeadInput, CreateLeadResponse } from '@wi/shared';
import type { LeadRepository } from './lead-repository.js';

export class LeadService {
  constructor(private readonly deps: { repo: LeadRepository }) {}

  /**
   * Stores a consultation request. A filled honeypot means a bot: we answer with the same success
   * response (so it learns nothing) but store nothing. Input is already trimmed/validated by Zod.
   */
  async create(input: CreateLeadInput): Promise<CreateLeadResponse> {
    if (input.hp && input.hp.trim() !== '') return { received: true };
    const { hp: _hp, ...lead } = input;
    await this.deps.repo.create(lead);
    return { received: true };
  }
}
