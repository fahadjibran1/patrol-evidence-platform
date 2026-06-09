import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { UsersService } from '@/users/users.service';
import { LoginDto } from './dto/login.dto';
import { TokenService } from './token.service';
import { verifyPassword } from './security/password.util';
import { UserRole } from '@/common/enums/user-role.enum';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly tokenService: TokenService,
  ) {}

  async login(dto: LoginDto): Promise<{
    accessToken: string;
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: UserRole;
      companyId: string | null;
      active: boolean;
      approved: boolean;
    };
  }> {
    const user = await this.usersService.findByEmail(dto.email.trim().toLowerCase());
    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const passwordMatches = await verifyPassword(dto.password, user.passwordHash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Invalid email or password');
    }

    if (!user.active) {
      throw new ForbiddenException('User account is inactive');
    }

    if (user.role !== UserRole.ADMIN && !user.companyId) {
      throw new ForbiddenException('User is not assigned to a company');
    }

    if (user.role === UserRole.GUARD && !user.approved) {
      throw new ForbiddenException('Guard account is pending approval');
    }

    return {
      accessToken: this.tokenService.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
        companyId: user.companyId,
      }),
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        companyId: user.companyId,
        active: user.active,
        approved: user.approved,
      },
    };
  }

  async me(userId: string): Promise<{
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    companyId: string | null;
    active: boolean;
    approved: boolean;
  }> {
    const user = await this.usersService.findById(userId);

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      companyId: user.companyId,
      active: user.active,
      approved: user.approved,
    };
  }
}
