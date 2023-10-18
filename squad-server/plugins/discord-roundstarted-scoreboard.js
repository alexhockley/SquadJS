
import DiscordBasePlugin from './discord-base-plugin.js';
import Sequelize from 'sequelize';
const { QueryTypes } = Sequelize;

export default class DiscordRoundStartedScoreboard extends DiscordBasePlugin {
  static get description() {
    return 'The <code>DiscordRoundStartedScoreboard</code> plugin will build and send a scoreboard to a Discord channel.';
  }

  static get defaultEnabled() {
    return true;
  }

  static get optionsSpecification() {
    return {
      ...DiscordBasePlugin.optionsSpecification,
      channelID: {
        required: true,
        description: 'The ID of the channel to post the scooreboard to.',
        default: '',
        example: '667741905228136459'
      },
      color: {
        required: false,
        description: 'The color of the embed.',
        default: 16761867
      },
      database: {
        required: true,
        connector: 'sequelize',
        description: 'The Sequelize connector to log server information to.',
        default: 'mysql'
      },
    };
  }

  static get baseQuery(){
    return `WITH sub_kills as (
            SELECT
              attackerName as player,
                  attackerTeamId as teamid,
                  count(*) as cnt
            FROM DBLog_Deaths 
              WHERE \`match\` = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              AND teamkill = 0
              GROUP BY attackerName, attackerTeamId
          ),
          sub_teamkills as (
            SELECT
              attackerName as player,
                  attackerTeamId as teamid,
                  count(*) as cnt
            FROM DBLog_Deaths 
              WHERE \`match\` = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              AND teamkill = 1
              GROUP BY attackerName, attackerTeamID
          ),
          sub_teamkilled as (
            SELECT
              victimName as player,
                  victimTeamID as teamid,
                  count(*) as cnt
            FROM DBLog_Deaths 
              WHERE \`match\` = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              AND teamkill = 1
              GROUP BY victimName,victimTeamID
          ),
          sub_deaths as (
            SELECT
              victimName as player,
                  victimTeamID as teamid,
                  count(*) as cnt
            FROM DBLog_Deaths 
              WHERE \`match\` = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              GROUP BY victimName,victimTeamID
          ),
          sub_wounds as (
            SELECT
              victimName as player,
                  victimTeamID as teamid,
                  count(*) as cnt
            FROM DBLog_Deaths 
              WHERE "match" = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              GROUP BY victimName,victimTeamID
          ),
          sub_revives as (
            SELECT
              reviverName as player,
                  reviverTeamID as teamid,
                  count(*) as cnt
            FROM DBLog_Revives 
              WHERE \`match\` = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              GROUP BY reviverName, reviverTeamID
          ),
          sub_revived as (
            SELECT
              victimName as player,
              victimTeamID as teamid,
                  count(*) as cnt
            FROM DBLog_Revives 
              WHERE \`match\` = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)
              GROUP BY victimName, victimTeamID
          ),
          sub_all_players_pregroup as (
             SELECT player, teamid FROM sub_kills
             UNION SELECT player, teamid FROM sub_teamkills
             UNION SELECT player, teamid FROM sub_deaths
             UNION SELECT player, teamid FROM sub_wounds
             UNION SELECT player, teamid FROM sub_revives
          ),
          sub_all_players as (
             SELECT player,teamid FROM sub_all_players_pregroup GROUP BY player, teamid
          ),
          sub_scoreboard_stats as (
          SELECT 
            ap.player,
              ap.teamid,
              coalesce(k.cnt,0) as kills,
              coalesce(d.cnt,0) as deaths,
              coalesce(tk.cnt,0) as teamkills,
              coalesce(tkd.cnt,0) as teamkilled,
              coalesce(r.cnt,0) as revives,
              coalesce(w.cnt,0) as wounds,
              coalesce(u.cnt,0) as revived
          FROM sub_all_players ap 
          LEFT JOIN sub_kills k ON k.player = ap.player AND k.teamid=ap.teamid
          LEFT JOIN sub_deaths d ON d.player = ap.player AND d.teamid=ap.teamid
          LEFT JOIN sub_teamkills tk ON tk.player = ap.player AND tk.teamid=ap.teamid
          LEFT JOIN sub_teamkilled tkd ON tkd.player = ap.player AND tkd.teamid=ap.teamid
          LEFT JOIN sub_revives r ON r.player = ap.player AND r.teamid=ap.teamid
          LEFT JOIN sub_wounds w ON w.player = ap.player AND w.teamid=ap.teamid
          LEFT JOIN sub_revived u ON u.player = ap.player AND u.teamid=ap.teamid
          ),
          t_scoreboards as (
            SELECT * FROM sub_scoreboard_stats
          )
          `;
  }

  constructor(server, options, connectors) {
    super(server, options, connectors);
    this.onRoundStart = this.onRoundStart.bind(this);
  }

  async mount() {
    this.server.on('ROUND_STARTED', this.onRoundStart);
  }

  async unmount() {
    this.server.removeEventListener('ROUND_STARTED', this.onRoundStart);
  }

  async onRoundStart(info) {
    let scoreboardData = await this.buildScoreboard();

    await this.sendDiscordMessage({
      embed: {
        title: `TT Scoreboards | ${scoreboardData.match.map} - ${scoreboardData.match.layer}`,
        description: `${scoreboardData.match.team1} vs ${scoreboardData.match.team2} || ${scoreboardData.match.winnerTeam} won with ${scoreboardData.match.tickets} tickets.`,
        color: this.options.color,
        fields: [
          {
            name: `Top 3 Fraggers <:calmDown:983772725040513184>`,
            value: this.formatTable(scoreboardData.awards.kills),
            inline:true
          },
          {
            name: `Cannon Fodder <:microgg:1052690609967743097> (Most Deaths)`,
            value: this.formatTable(scoreboardData.awards.deaths),
            inline:true,
          },
          {
            name: `Combat Medic <:pepeLove:980726517531308032> (Most Revives)`,
            value: this.formatTable(scoreboardData.awards.revives),
          },
          {
            name: `Never Give Up <:gigaChad:985711856524066817> (Most Revived)`,
            value: this.formatTable(scoreboardData.awards.revived),
            inline:true,
          },
          {
            name: `Looks Sussy <:hugPepe:981453760800915497> (Most Teamkilled)`,
            value: this.formatTable(scoreboardData.awards.teamkilled),
            inline:true,
          },
          {
            name: `Unfriendly Fire <:cheemsBonk:980726377496051743> (Most Teamkills)`,
            value: this.formatTable(scoreboardData.awards.teamkills),
          }
        ],
        timestamp: info.time.toISOString()
      }
    });
  }

  formatTable(data){
    let str = "";
    data.forEach((element) => {
      str += Object.values(element).join(" - ") + "\n"
    });
    return str;
  }


  async buildScoreboard(){

    let scoreboardData = {
      "awards":{
        "kills":[],
        "deaths":[],
        "revives":[],
        "teamkilled":[],
        "teamkills":[]
      },
      "match":{}
    };
      scoreboardData.awards.kills = await this.options.database.query(DiscordRoundStartedScoreboard.baseQuery +"SELECT player, kills FROM t_scoreboards ORDER BY kills DESC LIMIT 3;",{ type: QueryTypes.SELECT });
      scoreboardData.awards.deaths = await this.options.database.query(DiscordRoundStartedScoreboard.baseQuery +"SELECT player, deaths FROM t_scoreboards ORDER BY deaths DESC LIMIT 3;",{ type: QueryTypes.SELECT });
      scoreboardData.awards.revives = await this.options.database.query(DiscordRoundStartedScoreboard.baseQuery +"SELECT player, revives FROM t_scoreboards ORDER BY revives DESC LIMIT 3;",{ type: QueryTypes.SELECT });
      scoreboardData.awards.revived = await this.options.database.query(DiscordRoundStartedScoreboard.baseQuery +"SELECT player, revived FROM t_scoreboards ORDER BY revived DESC LIMIT 3;",{ type: QueryTypes.SELECT });
      scoreboardData.awards.teamkilled = await this.options.database.query(DiscordRoundStartedScoreboard.baseQuery +"SELECT player, teamkilled FROM t_scoreboards ORDER BY teamkilled DESC LIMIT 3;",{ type: QueryTypes.SELECT });
      scoreboardData.awards.teamkills = await this.options.database.query(DiscordRoundStartedScoreboard.baseQuery +"SELECT player, teamkills FROM t_scoreboards ORDER BY teamkills DESC LIMIT 3;",{ type: QueryTypes.SELECT });
      scoreboardData.match = await this.options.database.query("SELECT map, layer, tickets, winnerTeam, winnerTeamId, team1, team2 FROM DBLog_Matches where id = (SELECT max(id) FROM DBLog_Matches WHERE endTime IS NOT NULL)",{ type: QueryTypes.SELECT });
      scoreboardData.match = scoreboardData.match[0]
      return scoreboardData;
  }
}
