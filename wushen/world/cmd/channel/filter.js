this.inherits(COMMAND);
this.command = "filter";
this.enter = function (me, str) {

}
UTIL.check_word = function (str) {
    for (var i = 0; i < UTIL.workds_regex.length; i++) {
        if (UTIL.workds_regex[i].test(str)) {
            return false;
        }
    }
    return true;
}
UTIL.replace_word = function (str) {
    for (var i = 0; i < UTIL.workds_regex.length; i++) {
        str = str.replace(UTIL.workds_regex[i], "*");
    }
    return str;
}
UTIL.add_world = function (str) {
    UTIL.workds_regex.push(new RegExp(str));
}

var workds = [
   ];

UTIL.workds_regex = [];
for (var i = 0; i < workds.length; i++) {
    workds[i] = new RegExp(workds[i]);
}
UTIL.workds_regex = workds;