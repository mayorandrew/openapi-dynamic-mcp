import { OAuthClient } from './oauthClient.js';
import { OpenApiMcpError } from '../errors.js';
import type {
  EndpointDefinition,
  LoadedApi,
  ResolvedAuthResult,
  ResolvedAuthScheme,
} from '../types.js';
import {
  resolveSchemeForRequest,
  type RequirementFailure,
} from './schemeAuth.js';
import type { AuthStore } from './authStore.js';

interface ResolveAuthInput {
  api: LoadedApi;
  endpoint: EndpointDefinition;
  oauthClient: OAuthClient;
  env?: NodeJS.ProcessEnv;
  authStore?: AuthStore;
}

export async function resolveAuth({
  api,
  endpoint,
  oauthClient,
  env = process.env,
  authStore,
}: ResolveAuthInput): Promise<ResolvedAuthResult> {
  const requirements = endpoint.operation.security ?? api.schema.security ?? [];
  if (!requirements || requirements.length === 0) {
    return { authUsed: [], schemes: [] };
  }

  const failures: RequirementFailure[] = [];

  for (const requirementObject of requirements) {
    if (Object.keys(requirementObject).length === 0) {
      return { authUsed: [], schemes: [] };
    }

    const resolved: ResolvedAuthScheme[] = [];
    const missingEnv = new Set<string>();
    let failedReason: string | undefined;

    for (const [schemeName, requestedScopes] of Object.entries(
      requirementObject,
    )) {
      const schemeResult = await resolveSchemeForRequest({
        api,
        schemeName,
        requestedScopes,
        oauthClient,
        env,
        authStore,
      });

      if (schemeResult.status === 'interactive') {
        return {
          authUsed: [],
          schemes: [],
          interactiveAuth: schemeResult.interactiveAuth,
        };
      }

      if (schemeResult.status === 'failed') {
        for (const item of schemeResult.missingEnv) {
          missingEnv.add(item);
        }
        failedReason = schemeResult.failedReason;
        break;
      }

      resolved.push(schemeResult.resolved);
    }

    if (!failedReason) {
      return {
        authUsed: resolved.map((item) => item.schemeName),
        schemes: resolved,
      };
    }

    failures.push({
      requirement: Object.keys(requirementObject),
      reason: failedReason,
      missingEnv: [...missingEnv],
    });
  }

  const allMissingEnv = [
    ...new Set(failures.flatMap((failure) => failure.missingEnv ?? [])),
  ];
  const envHint =
    allMissingEnv.length > 0
      ? `. Set environment variable(s): ${allMissingEnv.join(', ')}`
      : '';

  throw new OpenApiMcpError(
    'AUTH_ERROR',
    `Could not resolve authentication for '${api.config.name}'${envHint}`,
    {
      endpointId: endpoint.endpointId,
      failures,
    },
  );
}
