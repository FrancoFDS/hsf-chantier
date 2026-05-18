# Notifications Email — Edge Functions

Deux fonctions Deno à déployer sur Supabase.

## 1. Pré-requis

### Compte Resend (envoi d'email)
1. Crée un compte sur https://resend.com (gratuit jusqu'à 3000 emails/mois)
2. Vérifie ton domaine (ou utilise `onboarding@resend.dev` pour tester)
3. Crée une API key dans Settings > API Keys

### Variables d'environnement Supabase
Dans Supabase Dashboard > Project Settings > Edge Functions > Secrets, ajoute :

```
RESEND_API_KEY=re_xxxxxx
RESEND_FROM_EMAIL=Planify <noreply@tondomaine.com>
APP_URL=https://hsf-chantier.vercel.app
```

(`SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` sont auto-injectés par Supabase.)

## 2. Déploiement

### Installer Supabase CLI (une fois)
```sh
brew install supabase/tap/supabase
supabase login
supabase link --project-ref <ton-project-ref>
```

### Déployer les deux fonctions
```sh
cd /Users/francofds/Projects/planify
supabase functions deploy notes-digest --no-verify-jwt
supabase functions deploy notes-alert --no-verify-jwt
```

`--no-verify-jwt` car ces fonctions sont déclenchées par cron/webhook, pas par un user.

## 3. Configuration

### notes-digest (email matinal)
Dans Supabase Dashboard > Database > Cron Jobs :
- Schedule : `0 8 * * 1-5` (lun-ven à 8h)
- Command :
  ```sql
  SELECT net.http_post(
    url := 'https://<project-ref>.supabase.co/functions/v1/notes-digest',
    headers := jsonb_build_object('Authorization', 'Bearer <anon-key>')
  );
  ```
- Active l'extension `pg_net` et `pg_cron` si pas déjà fait

### notes-alert (notification immédiate)
Dans Supabase Dashboard > Database > Webhooks :
- Name : `notes-insert-alert`
- Table : `notes`
- Events : INSERT
- Type : HTTP Request
- URL : `https://<project-ref>.supabase.co/functions/v1/notes-alert`
- Method : POST
- Headers : `Authorization: Bearer <anon-key>`

## 4. Test
```sh
# Local
supabase functions serve

# Tester digest
curl http://localhost:54321/functions/v1/notes-digest

# Tester alert
curl -X POST http://localhost:54321/functions/v1/notes-alert \
  -H 'Content-Type: application/json' \
  -d '{"type":"INSERT","record":{...}}'
```

## 5. Comportement

**notes-digest** :
- Récupère toutes les notes status ∈ {ouvert, en_cours}, non supprimées, non réponses
- Groupe par `company_codes` + `mentioned_companies`
- Envoie un email à chaque entreprise active (avec son `email`) **sauf** si `email_digest=false` dans `company_notif_prefs`

**notes-alert** :
- Déclenché à chaque INSERT sur `notes` (sauf réponses et notes supprimées)
- Envoie un email à chaque entreprise dans `company_codes` ∪ `mentioned_companies`
- Sauf si `email_immediate=false` dans `company_notif_prefs`
- Email marqué « MENTION » (violet) si l'entreprise est dans `mentioned_companies`
