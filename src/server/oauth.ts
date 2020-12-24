import {Request, Response} from 'express';
import axios from 'axios';
import {Webhook} from '../util/Webhook';
import {Webhooks} from '../db/models';

export async function oauth2(
  req: Request<
    {},
    {},
    {},
    {
      code?: string;
      guild_id?: string;
    }
  >,
  res: Response
) {
  if (!req.query.code || !req.query.guild_id) {
    return res.render('error');
  }

  const gid = /\d{16,18}/.exec(req.query.guild_id);

  const found = await Webhooks.findById(gid?.input);

  if (found) {
    return res
      .status(200)
      .send('You already have a status page feed in your server.');
  }

  const endpoint = 'https://discord.com/api/v8/oauth2/token';

  const body = {
    client_id: process.env.CLIENT_ID!,
    client_secret: process.env.CLIENT_SECRET!,
    grant_type: 'authorization_code',
    code: req.query.code,
    redirect_uri: 'https://dev.red-panda.red/auth/callback',
    scope: 'webhooks.incoming applications.commands',
  };

  const result = await axios.post(endpoint, body, {
    validateStatus: null,
    transformRequest(json: Record<string, string>) {
      return Object.entries(json)
        .map(e => `${encodeURIComponent(e[0])}=${encodeURIComponent(e[1])}`)
        .join('&');
    },
  });

  if (result.status !== 200) {
    return res.render('error', {error: result.data});
  }

  const wh = new Webhook(result.data.webhook.url);
  const whs = await Webhooks.from(wh);

  try {
    await whs.save();
  } catch (error) {
    await wh.delete();

    return res.render('error', {error});
  }

  return res.render('success');
}

// TODO: proper error handling
// TODO: success page