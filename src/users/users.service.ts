import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(User)
    private readonly usersRepo: Repository<User>,
  ) {}

  findByEmail(email: string): Promise<User | null> {
    return this.usersRepo.findOne({
      where: { email: email.trim().toLowerCase() },
      relations: ['company'],
    });
  }

  async findById(id: string): Promise<User> {
    const user = await this.usersRepo.findOne({
      where: { id },
      relations: ['company'],
    });

    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return user;
  }
}
