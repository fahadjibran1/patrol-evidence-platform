import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { PaginationQueryDto, paginate, resolvePagination } from './pagination.dto';
import { SearchCustomersQueryDto } from '@/customers/dto/customer.dto';

const validateOpts = { whitelist: true, forbidNonWhitelisted: true };

describe('PaginationQueryDto', () => {
  it('accepts page and pageSize', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: 2, pageSize: 50 });
    expect(await validate(dto, validateOpts)).toHaveLength(0);
    expect(resolvePagination(dto)).toEqual({ page: 2, pageSize: 50, skip: 50, take: 50 });
  });

  it('transforms string query values to numbers', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: '3', pageSize: '25' });
    expect(await validate(dto, validateOpts)).toHaveLength(0);
    expect(dto.page).toBe(3);
    expect(dto.pageSize).toBe(25);
  });

  it('rejects page below 1', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: 0, pageSize: 25 });
    const errors = await validate(dto, validateOpts);
    expect(errors.some((error) => error.property === 'page')).toBe(true);
  });

  it('rejects pageSize above 100', async () => {
    const dto = plainToInstance(PaginationQueryDto, { page: 1, pageSize: 101 });
    const errors = await validate(dto, validateOpts);
    expect(errors.some((error) => error.property === 'pageSize')).toBe(true);
  });

  it('rejects unknown query properties on list DTOs', async () => {
    const dto = plainToInstance(SearchCustomersQueryDto, {
      page: 1,
      pageSize: 50,
      unexpected: 'nope',
    });
    const errors = await validate(dto, validateOpts);
    expect(errors.some((error) => error.property === 'unexpected')).toBe(true);
  });

  it('returns consistent pagination metadata', () => {
    expect(paginate(['a', 'b'], 40, 2, 25)).toEqual({
      items: ['a', 'b'],
      total: 40,
      page: 2,
      pageSize: 25,
      totalPages: 2,
    });
  });
});
