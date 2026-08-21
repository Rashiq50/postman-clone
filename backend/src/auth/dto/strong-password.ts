import { passwordProblem } from '@raven/contracts';
import {
  ValidatorConstraint,
  type ValidationArguments,
  type ValidatorConstraintInterface,
} from 'class-validator';

/**
 * The password policy, as a **single** `@Validate` constraint.
 *
 * ⚠️ One constraint rather than a stack of `@MinLength` + `@Matches`, so one
 * attempt produces one message: the form shows "must contain a number" instead
 * of a pile of overlapping complaints. And the rule itself is
 * `passwordProblem` from contracts — the same function `RegisterPage` and
 * `ProfilePage` pre-check with — so the client cannot accept something the API
 * rejects. Changing the policy means editing
 * [packages/contracts/src/password.ts](../../../../packages/contracts/src/password.ts)
 * and running `./dev.sh contracts`, never restating a regex here.
 *
 * ⚠️ It lives in its own file because `RegisterDto` and `ChangePasswordDto`
 * both need it. It was private to `register-dto.ts` until the second caller
 * arrived; a copy in the second DTO is exactly the drift this file prevents.
 */
@ValidatorConstraint({ name: 'strongPassword', async: false })
export class StrongPasswordConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return typeof value === 'string' && passwordProblem(value) === null;
  }

  defaultMessage(args: ValidationArguments): string {
    return typeof args.value === 'string'
      ? (passwordProblem(args.value) ?? 'Password is not acceptable')
      : 'Password must be a string';
  }
}
