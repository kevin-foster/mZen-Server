import ServerAclRoleAssessor from './acl/role-assessor';
import RoleAssessorAll from './acl/role-assessor/all';

export interface ServerAclConfigRule
{
  allow?:boolean; 
  role?:string;
}

export interface ServerAclConfig
{
  rules?:Array<ServerAclConfigRule>;
  endpoints?:any;
}

export class ServerAcl
{
  config:ServerAclConfig;
  roleAssessor:{[key:string]:ServerAclRoleAssessor};
  initcontextGroups:{[key: number]:[ServerAclRoleAssessor]};
  repos:{[key:string]:any};
  
  constructor(options?:ServerAclConfig)
  {
    this.config = options ? options : {};
    this.config.rules = this.config.rules ? this.config.rules : [];
    this.config.endpoints = this.config.endpoints ? this.config.endpoints : {};

    this.roleAssessor = {};
    this.loadDefaultRoleAssessors();
  }
  
  loadDefaultRoleAssessors()
  {
    this.addRoleAssessor(new RoleAssessorAll);
  }
  
  async populateContext(request, context?, remoteObject?)
  {
    // Initialise assessors in order of priority
    const roleAssessors = Object.values(this.roleAssessor);

    // Assessors grouped by priority
    let roleAssessorsGrouped = Object.values(roleAssessors)
    .reduce((groups, roleAssessor) => {
      if (groups[roleAssessor.priority] == undefined) groups[roleAssessor.priority] = [];
      groups[roleAssessor.priority].push(roleAssessor);
      return groups;
    }, []);

    // High priority should be at the start of the array
    roleAssessorsGrouped = 
      roleAssessorsGrouped
      .reverse()
      .filter(group => group != undefined);
    
    // Execute init context groups in order
    for (const group of roleAssessorsGrouped) {
      await Promise.all(group.map(
        roleAssessor => roleAssessor.initContext(request, context, remoteObject)
      ));
    }

    return true;
  }
  
  isPermitted(endpointName, context?)
  {
    endpointName = endpointName ? endpointName : '';
    context = context ? context : {};

    // We append the end point rules to the global rules as the endpoint rules should override the global rules
    var rules = this.getRules(endpointName);

    // We need to execute hasRole() for each rule in sequence so we will start with a resolved promise
    // By default nothing is permitted so we resolve false
    var promise = Promise.resolve(false);
    rules.forEach((rule) => {
      // Each rule applies only the specified role
      // To test if a given rule will permit or deny the user we need to check two things
      // - Does the user have the role - if not the rule is not applicable and we can move on
      // - Does the rule permit or deny the user
      promise = promise.then((initResult) => {
        const role = rule.role;
        return this.hasRole(role, context).then((userHasRole) => {
          // If the user does not have the role then we dont modify the permitted value
          // - we would return the initResult, so we can default to that value
          var result = initResult;
          if (!!userHasRole) {
            var initConditions = (typeof initResult == 'object') ? initResult : null;
            if (typeof userHasRole == 'object') {
              // An object was returned - this represents the conditions under which the user has the role
              if (initConditions) {
                // If we already had role ownership conditions we need to merge the new conditions
                for (var condition in userHasRole) {
                  initConditions[condition] = userHasRole[condition];
                }
                result = initConditions;
              } else {
                result = userHasRole;
              }
            } else if (userHasRole === true) {
              if (initConditions) {
                // The previous role assessor returned conditions - these still apply so we return them
                result = initConditions;
              } else {
                result = rule.allow !== undefined ? rule.allow : true;
              }
            }
          }
          return result;
        });
      });
    });

    return promise;
  }
  
  hasRole(role: string, context?): Promise<any | boolean>
  {
    // If a role assessor has been defined for this role we delegate
    var promise = Promise.resolve(false);
    const roleAssessor = this.roleAssessor[role];
    if (roleAssessor) {
      promise = roleAssessor.hasRole(context);
    }
    return promise;
  }
  
  addRule(rule)
  {
    if (Array.isArray(rule)) {
      this.config.rules = this.config.rules.concat(rule);
    } else {
      this.config.rules.push(rule);
    }
  }
  
  getRules(endpointName)
  {
    const globalRules = this.config.rules ? this.config.rules : [];
    const endpoint = endpointName && this.config.endpoints[endpointName] ? this.config.endpoints[endpointName] : {};
    const endpointAcl = endpoint.acl ? endpoint.acl : {};
    const endpointRules = endpointAcl.rules ? endpointAcl.rules : [];

    // We append the end point rules to the global rules as the endpointrules should override the global rules
    const rules = globalRules.concat(endpointRules);

    return rules;
  }
  
  setRepos(repos)
  {
    for (var role in this.roleAssessor) {
      this.roleAssessor[role].setRepos(repos);
    }
    this.repos = repos;
  }
  
  addRoleAssessor(assessor)
  {
    this.roleAssessor[assessor.role] = assessor;
    this.roleAssessor[assessor.role].setRepos(this.repos);
  }
  
}
/*
acl: {
  rules: [
    {allow: true, role: 'all'},
    {allow: true, role: 'authed'},
    {allow: true, role: 'unauthed'},
    {allow: true, role: 'owner'},
    {allow: true, role: 'rolename'},
    {allow: true, role: 'teamAdmin', contextArgs: {
      order: 'order'
    }},
  ]
}.
endpoints: {
  'post-create': {
    path: '/create',
    method: 'create',
    verbs: ['post'],
    args: [
      {srcName: 'email', src: 'body-field', required: true},
      {srcName: 'password', src: 'body-field', required: true}
    ],
    acl: {
      rules: [
        {allow: true, role: 'all'},
        {allow: true, role: 'authed'},
        {allow: true, role: 'unauthed'},
        {allow: true, role: 'owner'},
        {allow: true, role: 'rolename'},
        {allow: true, role: 'teamAdmin', contextArgs: {
          order: 'order'
        }},
      ]
    }
  },
*/

export default ServerAcl;
