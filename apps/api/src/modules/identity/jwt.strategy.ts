import { Injectable } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";

interface JwtPayload {
  sub: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, "jwt") {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: process.env.JWT_ACCESS_SECRET,
    });
  }

  // Deliberately minimal: request.user only ever carries { userId }.
  // Permissions are resolved fresh per-request by PermissionsGuard, never
  // trusted from the token payload.
  validate(payload: JwtPayload): { userId: string } {
    return { userId: payload.sub };
  }
}
