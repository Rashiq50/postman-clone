import { Transform } from "class-transformer";
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from "class-validator";

export class RegisterDto {
    @IsEmail()
    @IsNotEmpty()
    @MaxLength(320)
    @Transform(({ value }) => value.trim().toLowerCase())
    email: string;

    @IsString()
    @IsNotEmpty()
    @MaxLength(256)
    @MinLength(8)
    password: string;

    @IsNotEmpty()
    @IsString()
    @MaxLength(320)
    name: string;
}