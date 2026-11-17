# Suivi d'un film regardé sur la TV, par le serveur — conception courte

- **Date** : 17/11/2026
- **Statut** : approche choisie par Rusmir (A), document **validé le 17/11/2026** (« ok go ») ; tests sur le
  Pixel 9a et un vrai Chromecast prévus le 18/11
- **Base** : branche `feat/borne-location`

## Le problème (constaté par Rusmir, cause trouvée dans le code)

Pendant un Cast, la progression de la location n'est suivie que par le téléphone, et seulement tant que le
lecteur est ouvert et la page au premier plan :

- la sauvegarde toutes les 10 s vit dans `VHSPlayer` (`isPlayerOpen` requis) et le SDK du Cast n'écoute que
  lecteur ouvert (`useGoogleCast({ enabled: isPlayerOpen })`) ; Android gèle la page écran éteint ;
- la fin du film (récepteur à l'arrêt au-delà de 95 %) n'est vue que lecteur ouvert ;
- le serveur tient une séance de Cast avec une heure de fin estimée (`lib/cast-sessions.ts`) mais ne s'en sert
  que pour la notification « … est terminé ! Revenez rembobiner » (`lib/cast-session-checker.ts`) ; la
  location garde une progression basse, et le rembobinage est refusé (`watch_progress >= 80` exigé,
  `lib/rentals.ts:382`).

Résultat : film regardé sur la TV, téléphone éteint → à la réouverture le lecteur ne sait pas que le film est
fini, on ne peut pas rembobiner (ni, plus tard, critiquer).

**Intention [R]** : « une fois lancé on doit pouvoir fermer l'application » ; « un petit backend qui track tout
ceci sans que ce soit trop lourd ».

## Approches

| Approche | Décision |
|---|---|
| **A. Le serveur estime** : position de départ + horloge, corrigée par le téléphone quand il est là ; à l'heure de fin estimée, la location est notée vue | **Retenue [R]** |
| B. Récepteur Chromecast maison qui envoie la vraie position et bride l'avance rapide | **Écartée définitivement [R]** : « jamais le B, on ne veut pas payer ni être déclaré ni développer sur Chromecast » |

## Ce qui change

1. **Serveur — fin estimée d'une séance de Cast.** Le vérificateur (toutes les 60 s) trouve les séances non
   closes dont l'heure de fin estimée est passée. Pour chacune, **d'abord** il note la location de la séance
   comme vue : `watch_progress = 100`, `watch_position = 0`, `watch_completed_at` posé s'il ne l'était pas —
   même si la location a expiré entre-temps (l'historique doit dire vrai) ; **puis** il envoie la notification
   comme aujourd'hui. Noter la location ne dépend pas de la notification (un visiteur sans abonnement aux
   notifications doit aussi être servi) et peut se rejouer sans dommage. **[C]**
2. **Serveur — rien d'autre.** Le téléphone envoie déjà la vraie position quand il est là
   (`updatePosition`, toutes les 10 s, et à la reconnexion au récepteur) ; l'heure de fin estimée est
   recalculée à chaque envoi. **[C]**
3. **Lecteur — ouverture sur un film fini.** Quand le lecteur s'ouvre sur une location vue à 100 % dont le
   rembobinage n'a pas été réclamé, et qu'aucun Cast n'est en cours pour ce film, il propose tout de suite de
   rembobiner (le même « BE KIND REWIND » qu'en fin de film) au lieu de relancer le film depuis le début.
   Rembobinage déjà réclamé : ouverture normale. Vaut pour la borne, le vidéoclub et le lien de la
   notification (`/?castEnded=…`). **[C]**

## Limites acceptées

- Le serveur ne voit pas la TV : un film mis **en pause** sur la TV, téléphone éteint, sera noté fini trop tôt ;
  un film **avancé** sera noté fini trop tard ; un Cast **arrêté** depuis la TV au milieu sera noté fini quand
  même. Le téléphone corrige dès qu'il se reconnecte pendant la séance.
- **L'avance rapide reste libre** sur la TV (récepteur standard de Google).

## Hors de ce chantier

- L'écran « Mon compte » (historique, bonus, critiques, minimum de 144 caractères) — conçu à part, en attente
  de la réponse de Rusmir sur la règle des 80 %.
