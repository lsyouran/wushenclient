// 本文件由 `tools/gen-kotlin-protocol.mjs` 生成，**不要手改**。
// 真相在 `shared/protocol.ts`；协议改了重新生成：node tools/gen-kotlin-protocol.mjs
// 校验生成物是否落后于协议：node tools/gen-kotlin-protocol.mjs --check

package mud.protocol

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.decodeFromJsonElement

/** 协议版本（`shared/protocol.ts` 的 `PROTOCOL_VERSION`） */
const val PROTOCOL_VERSION: Int = 1

/** 所有服务端包的公共标记（`decodePacket` 返回它，调用方按具体类 when） */
sealed interface Packet

@Serializable
data class RolesPacket(
    val roles: List<RolesPacketRolesItem>,
) : Packet

@Serializable
data class LoginPacket(
    val id: String,
    val level: Int,
    val setting: Map<String, JsonElement>? = null,
) : Packet

@Serializable
data class LoginerrorPacket(
    val code: String,
    val msg: String,
) : Packet

@Serializable
data class RegistPacket(
    val ok: Boolean,
    val code: String? = null,
    val result: String,
) : Packet

@Serializable
data class DeleterolePacket(
    val roleid: String,
) : Packet

@Serializable
data class CrossPacket(
    val sid: Int,
    val pid: String,
    val cross_type: String,
) : Packet

@Serializable
data class LevelupPacket(
    val level: Int,
) : Packet

@Serializable
data class RoomPacket(
    val path: String,
    val name: String,
    val desc: String,
    val commands: List<RoomPacketCommandsItem>,
) : Packet

@Serializable
data class ExitsPacket(
    val items: Map<String, String>,
) : Packet

@Serializable
data class ItemsPacket(
    val items: List<ItemsPacketItemsItem>,
) : Packet

@Serializable
data class ItemaddPacket(
    val id: String,
    val name: String,
    val p: Double? = null,
    val m: Double? = null,
    val l: Double? = null,
    val f: Double? = null,
    val o: Double? = null,
    val hp: Double? = null,
    val max_hp: Double? = null,
    val mp: Double? = null,
    val max_mp: Double? = null,
) : Packet

@Serializable
data class ItemremovePacket(
    val id: String,
) : Packet

@Serializable
data class ItemPacket(
    val id: String,
    val name: String,
    val desc: String,
    val commands: List<ItemPacketCommandsItem>,
) : Packet

@Serializable
data class ActionsPacket(
    val items: List<ActionsPacketItemsItem>,
) : Packet

@Serializable
data class AddActionPacket(
    val id: String? = null,
    val items: List<AddActionPacketItemsItem>? = null,
) : Packet

@Serializable
data class RemoveActionPacket(
    val id: String? = null,
    val items: List<RemoveActionPacketItemsItem>? = null,
) : Packet

@Serializable
data class CmdsPacket(
    val items: List<CmdsPacketItemsItem>,
) : Packet

@Serializable
data class MapPacket(
    val path: String,
    val map: List<MapPacketMapItem>,
) : Packet

@Serializable
data class UpdatemapPacket(
    val map: String,
    val id: String,
    val n: String,
    val pos: List<Double>,
) : Packet

@Serializable
data class WarnPacket(
    val content: String,
    val time: Double? = null,
    val cmds: List<WarnPacketCmdsItem>,
    val context: String? = null,
) : Packet

@Serializable
data class SettingPacket(
    val items: Map<String, JsonElement>,
) : Packet

@Serializable
data class PayPacket(
    val url: String,
    val order_id: String,
) : Packet

@Serializable
data class EmotePacket(
    val items: List<String>,
) : Packet

@Serializable
data class CombatPacket(
    val start: Double? = null,
    val end: Double? = null,
) : Packet

@Serializable
data class ScPacket(
    val id: String,
    val hp: Double? = null,
    val max_hp: Double? = null,
    val mp: Double? = null,
    val max_mp: Double? = null,
    val damage: Double? = null,
) : Packet

@Serializable
data class StatusPacket(
    val id: String,
    val action: String,
    val sid: List<String>? = null,
    val name: String? = null,
    val duration: Double? = null,
    val count: Double? = null,
) : Packet

@Serializable
data class DiePacket(
    val relive: Boolean? = null,
    val commands: List<DiePacketCommandsItem>? = null,
) : Packet

@Serializable
data class StatePacket(
    val state: String,
    val desc: String,
) : Packet

@Serializable
data class PerformPacket(
    val items: List<PerformPacketItemsItem>,
) : Packet

@Serializable
data class DispfmPacket(
    val id: String? = null,
    val rtime: Double? = null,
    val time: Double? = null,
    val count: Double? = null,
) : Packet

@Serializable
data class DisobjPacket(
    val id: String? = null,
    val rtime: Double? = null,
    val time: Double? = null,
    val count: Double? = null,
) : Packet

@Serializable
data class ChangepfmPacket(
    val id: String? = null,
    val rtime: Double? = null,
    val time: Double? = null,
    val count: Double? = null,
) : Packet

@Serializable
data class ClearDistimePacket(
    val id: String? = null,
    val rtime: Double? = null,
    val time: Double? = null,
    val count: Double? = null,
) : Packet

@Serializable
data class MsgPacket(
    val ch: String,
    val content: String,
    val uid: Int? = null,
    val name: String? = null,
    val fam: String? = null,
    val lv: Int? = null,
) : Packet

@Serializable
data class DialogPacket(
    val dialog: String,
    val close: Boolean? = null,
    val refresh: Double? = null,
    val clear: JsonElement? = null,
    val remove: String? = null,
) : Packet

@Serializable
data class RolesPacketRolesItem(
    val id: String,
    val name: String,
    val title: String,
)

@Serializable
data class RoomPacketCommandsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class ItemsPacketItemsItem(
    val id: String,
    val name: String,
    val p: Double? = null,
    val m: Double? = null,
    val l: Double? = null,
    val f: Double? = null,
    val o: Double? = null,
    val hp: Double? = null,
    val max_hp: Double? = null,
    val mp: Double? = null,
    val max_mp: Double? = null,
)

@Serializable
data class ItemPacketCommandsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class ActionsPacketItemsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class AddActionPacketItemsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class RemoveActionPacketItemsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class CmdsPacketItemsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class MapPacketMapItem(
    val n: String,
    val id: String,
    val p: List<Double>,
    val exits: List<String>,
)

@Serializable
data class WarnPacketCmdsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class DiePacketCommandsItem(
    val cmd: String,
    val name: String,
)

@Serializable
data class PerformPacketItemsItem(
    val cmd: String,
    val name: String,
)

/**
 * 按 `type` 字段分派到具体包类。
 *
 * ★ `v` 不匹配 ⇒ 返回 `null`（调用方按"协议版本不一致"处理，不要静默继续）。
 * ★ `ignoreUnknownKeys = true` 对应协议的 `.strip()` 语义：服务端多给的字段丢弃。
 *   这**不会**掩盖字段名抄错 —— 抄错的那个字段在 JSON 里找不到，必报 `MissingFieldException`。
 * ★ 用 `as? JsonPrimitive` 而不是 `jsonPrimitive` 扩展：后者在类型不对时**抛异常**，
 *   而这里要的是"不是就返回 null"（一个畸形包不该让整条连接崩掉）。
 */
val PacketJson = Json { ignoreUnknownKeys = true }

fun decodePacket(text: String): Packet? {
    // 非 JSON ⇒ null（"这不是协议帧"）；缺必需字段仍然抛 —— 两种失败要能分开
    val obj = runCatching { PacketJson.parseToJsonElement(text) }.getOrNull() as? JsonObject ?: return null
    val v = (obj["v"] as? JsonPrimitive)?.content?.toIntOrNull()
    if (v != PROTOCOL_VERSION) return null
    return when ((obj["type"] as? JsonPrimitive)?.content) {
        "roles" -> PacketJson.decodeFromJsonElement(RolesPacket.serializer(), obj)
        "login" -> PacketJson.decodeFromJsonElement(LoginPacket.serializer(), obj)
        "loginerror" -> PacketJson.decodeFromJsonElement(LoginerrorPacket.serializer(), obj)
        "regist" -> PacketJson.decodeFromJsonElement(RegistPacket.serializer(), obj)
        "deleterole" -> PacketJson.decodeFromJsonElement(DeleterolePacket.serializer(), obj)
        "cross" -> PacketJson.decodeFromJsonElement(CrossPacket.serializer(), obj)
        "levelup" -> PacketJson.decodeFromJsonElement(LevelupPacket.serializer(), obj)
        "room" -> PacketJson.decodeFromJsonElement(RoomPacket.serializer(), obj)
        "exits" -> PacketJson.decodeFromJsonElement(ExitsPacket.serializer(), obj)
        "items" -> PacketJson.decodeFromJsonElement(ItemsPacket.serializer(), obj)
        "itemadd" -> PacketJson.decodeFromJsonElement(ItemaddPacket.serializer(), obj)
        "itemremove" -> PacketJson.decodeFromJsonElement(ItemremovePacket.serializer(), obj)
        "item" -> PacketJson.decodeFromJsonElement(ItemPacket.serializer(), obj)
        "actions" -> PacketJson.decodeFromJsonElement(ActionsPacket.serializer(), obj)
        "addAction" -> PacketJson.decodeFromJsonElement(AddActionPacket.serializer(), obj)
        "removeAction" -> PacketJson.decodeFromJsonElement(RemoveActionPacket.serializer(), obj)
        "cmds" -> PacketJson.decodeFromJsonElement(CmdsPacket.serializer(), obj)
        "map" -> PacketJson.decodeFromJsonElement(MapPacket.serializer(), obj)
        "updatemap" -> PacketJson.decodeFromJsonElement(UpdatemapPacket.serializer(), obj)
        "warn" -> PacketJson.decodeFromJsonElement(WarnPacket.serializer(), obj)
        "setting" -> PacketJson.decodeFromJsonElement(SettingPacket.serializer(), obj)
        "pay" -> PacketJson.decodeFromJsonElement(PayPacket.serializer(), obj)
        "emote" -> PacketJson.decodeFromJsonElement(EmotePacket.serializer(), obj)
        "combat" -> PacketJson.decodeFromJsonElement(CombatPacket.serializer(), obj)
        "sc" -> PacketJson.decodeFromJsonElement(ScPacket.serializer(), obj)
        "status" -> PacketJson.decodeFromJsonElement(StatusPacket.serializer(), obj)
        "die" -> PacketJson.decodeFromJsonElement(DiePacket.serializer(), obj)
        "state" -> PacketJson.decodeFromJsonElement(StatePacket.serializer(), obj)
        "perform" -> PacketJson.decodeFromJsonElement(PerformPacket.serializer(), obj)
        "dispfm" -> PacketJson.decodeFromJsonElement(DispfmPacket.serializer(), obj)
        "disobj" -> PacketJson.decodeFromJsonElement(DisobjPacket.serializer(), obj)
        "changepfm" -> PacketJson.decodeFromJsonElement(ChangepfmPacket.serializer(), obj)
        "clearDistime" -> PacketJson.decodeFromJsonElement(ClearDistimePacket.serializer(), obj)
        "msg" -> PacketJson.decodeFromJsonElement(MsgPacket.serializer(), obj)
        "dialog" -> PacketJson.decodeFromJsonElement(DialogPacket.serializer(), obj)
        else -> null
    }
}
