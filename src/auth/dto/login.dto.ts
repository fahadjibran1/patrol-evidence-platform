import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  email!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  password!: string;
}
